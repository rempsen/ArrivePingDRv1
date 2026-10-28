/**
 * Job forms v2 — the form a technician fills in on a job.
 *
 * Renders a JobForm (lib/forms/job-form-data.ts) with the shared model in
 * lib/forms/form-model.ts: sections as collapsible cards, every question type,
 * required / flagged / office-only markers, and "show only if" logic (the
 * visible set is recomputed from the answers on every change).
 *
 * Saving: every answer is applied on screen immediately and sent through
 * TanStack Query (useSaveJobAnswers), so with no signal the save is paused and
 * replays on reconnect. Each answer carries the moment it was given (`at`),
 * which is what the server uses to keep the newer answer per question.
 * Typed answers save ~600 ms after the last keystroke, and on blur.
 *
 * The job screen talks to it through a ref (JobFormHandle): flush() commits
 * half-typed answers and returns what's still missing; scrollToItem() jumps
 * to a question (expanding its section) and can highlight the missing ones.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Image,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  type KeyboardTypeOptions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { choosePhotoSource, pickPhoto, type PhotoSource } from "../lib/pick-photo";
import { useMutationState, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwise,
  CaretDown,
  CaretUp,
  Camera,
  CheckSquare,
  ClipboardText,
  CloudCheck,
  CloudSlash,
  Flag,
  Info,
  Lock,
  Signature,
  Square,
  X,
} from "phosphor-react-native";
import { C, R, assetUrl } from "../lib/theme";
import { useIsOnline } from "../lib/network";
import { addJobPhoto, onPhotoUploaded, pendingLabel, retryPendingPhoto, discardPendingPhoto, usePendingPhotos, type PendingPhoto } from "../lib/photo-queue";
import { Segment, SignaturePad } from "./signature-pad";
import {
  flaggedItems,
  isAnswered,
  isFlagged,
  isInputItem,
  mergeAnswers,
  missingRequired,
  progress,
  sectionsOf,
  visibleItems,
  type Answer,
  type Answers,
  type FormItem,
} from "../lib/forms/form-model";
import {
  buildAnswer,
  choiceAsButtons,
  combineAnswers,
  maskDate,
  maskTime,
  missingQuestions,
  nowLocal,
  numberHint,
  outOfRange,
  parseDateInput,
  parseNumberInput,
  parseTimeInput,
  signatureStrokes,
  strokesToSignatureDataUrl,
  todayLocal,
  type AnswerInput,
  type JobForm as JobFormData,
  type MissingQuestion,
  type Parsed,
} from "../lib/forms/job-form-data";
import { jobFormSaveKey, useSaveJobAnswers } from "../lib/forms/use-job-form";

export interface JobFormHandle {
  /** Commit any half-typed answers now; returns the required questions still unanswered. */
  flush(): MissingQuestion[];
  /** Required questions still unanswered (without committing drafts). */
  missing(): MissingQuestion[];
  /** Scroll the page to a question, expanding its section; optionally highlight questions as missing. */
  scrollToItem(id: string, opts?: { highlight?: string[] }): void;
}

type Commit = (item: FormItem, input: AnswerInput, at?: Date) => Answer | null;
type Register = (id: string, flush: (() => Answer | null) | null) => void;
type PhotoRef = { id: string; url: string };

export const JobForm = forwardRef<
  JobFormHandle,
  {
    bookingId: string;
    data: JobFormData;
    /** The job's photos (["photos", bookingId] query), for thumbnails. */
    photos?: PhotoRef[];
    /** The page ScrollView the form sits in, for scrollToItem. */
    scrollRef?: RefObject<ScrollView | null>;
    /** Show answers without letting them change (e.g. a finished job). */
    readOnly?: boolean;
    /** Questions to mark as missing (e.g. from the server's 409). */
    highlightIds?: string[];
  }
>(function JobForm({ bookingId, data, photos, scrollRef, readOnly, highlightIds }, ref) {
  const qc = useQueryClient();
  const save = useSaveJobAnswers(bookingId);
  const { form, answers } = data;

  const visible = useMemo(() => visibleItems(form, answers), [form, answers]);
  const groups = useMemo(() => sectionsOf(visible), [visible]);
  const missingIds = useMemo(() => new Set(missingRequired(form, answers).map((i) => i.id)), [form, answers]);
  const prog = useMemo(() => progress(form, answers), [form, answers]);
  const flaggedCount = useMemo(() => flaggedItems(form, answers).length, [form, answers]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = useState<Set<string>>(() => new Set(highlightIds ?? []));
  const highlightKey = (highlightIds ?? []).join(",");
  useEffect(() => {
    if (highlightKey) setHighlight(new Set(highlightKey.split(",")));
  }, [highlightKey]);

  const itemRefs = useRef(new Map<string, View>());
  const flushers = useRef(new Map<string, () => Answer | null>());

  const mutate = save.mutate;
  const commit = useCallback<Commit>(
    (item, input, at) => {
      if (readOnly) return null;
      const a = buildAnswer(item, input, at ?? new Date());
      mutate({ [item.id]: a });
      return a;
    },
    [mutate, readOnly],
  );
  const register = useCallback<Register>((id, fn) => {
    if (fn) flushers.current.set(id, fn);
    else flushers.current.delete(id);
  }, []);

  const scrollToItem = useCallback(
    (id: string, opts?: { highlight?: string[] }) => {
      if (opts?.highlight) setHighlight(new Set(opts.highlight));
      const secId = groups.find((g) => g.items.some((i) => i.id === id))?.section?.id;
      const expand = !!secId && !!collapsed[secId];
      if (expand) setCollapsed((c) => ({ ...c, [secId!]: false }));
      setTimeout(
        () => {
          const node = itemRefs.current.get(id);
          const sv = scrollRef?.current;
          if (!node || !sv) return;
          const inner = (sv as any).getInnerViewRef?.() ?? sv.getInnerViewNode();
          if (!inner) return;
          node.measureLayout(
            inner,
            (_x, y) => sv.scrollTo({ y: Math.max(0, y - 96), animated: true }),
            () => {},
          );
        },
        expand ? 150 : 30,
      );
    },
    [groups, collapsed, scrollRef],
  );

  useImperativeHandle(
    ref,
    () => ({
      flush() {
        const extra: Answers = {};
        for (const [id, fn] of flushers.current) {
          const a = fn();
          if (a) extra[id] = a;
        }
        return missingQuestions(form, mergeAnswers(answers, extra));
      },
      missing() {
        return missingQuestions(form, answers);
      },
      scrollToItem,
    }),
    [form, answers, scrollToItem],
  );

  const pct = prog.total ? Math.round((prog.answered / prog.total) * 100) : 0;

  return (
    <View style={st.wrap}>
      {/* Header: name, progress, flagged count, save status */}
      <View style={st.headCard}>
        <View style={st.headRow}>
          <ClipboardText color={C.brand} size={18} weight="fill" />
          <Text style={st.headTitle} numberOfLines={2}>
            {data.templateName || "Job form"}
          </Text>
          <SaveStatus bookingId={bookingId} onRetry={(a) => mutate(a)} />
        </View>
        <View
          style={st.barTrack}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${prog.answered} of ${prog.total} answered`}
          accessibilityValue={{ min: 0, max: prog.total, now: prog.answered }}
        >
          <View style={[st.barFill, { width: `${pct}%` }, prog.answered === prog.total && prog.total > 0 && { backgroundColor: C.green }]} />
        </View>
        <View style={st.headMeta}>
          <Text style={st.headCount}>
            {prog.answered} of {prog.total} answered
          </Text>
          {missingIds.size > 0 && (
            <Text style={st.headMissing}>
              {missingIds.size} required left
            </Text>
          )}
          {flaggedCount > 0 && (
            <View style={st.flagPill}>
              <Flag color={C.red} size={12} weight="fill" />
              <Text style={st.flagPillTxt}>{flaggedCount} flagged</Text>
            </View>
          )}
        </View>
        {readOnly && <Text style={st.readOnlyNote}>This form is closed — answers are shown for reference.</Text>}
      </View>

      {groups.map((g, gi) => {
        const inputs = g.items.filter(isInputItem);
        const done = inputs.filter((i) => isAnswered(i, answers[i.id])).length;
        const secId = g.section?.id;
        const isCollapsed = !!secId && !!collapsed[secId];
        const hasMissing = inputs.some((i) => missingIds.has(i.id));
        return (
          <View key={secId ?? `lead-${gi}`} style={st.sectionCard}>
            {g.section && (
              <Pressable
                onPress={() => setCollapsed((c) => ({ ...c, [secId!]: !isCollapsed }))}
                style={st.sectionHead}
                accessibilityRole="button"
                accessibilityState={{ expanded: !isCollapsed }}
                accessibilityLabel={`${g.section.label}, ${done} of ${inputs.length} answered`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={st.sectionTitle}>{g.section.label}</Text>
                  {!!g.section.help && <Text style={st.sectionHelp}>{g.section.help}</Text>}
                </View>
                {inputs.length > 0 && (
                  <Text
                    style={[
                      st.sectionCount,
                      done === inputs.length && { color: C.green },
                      hasMissing && isCollapsed && { color: C.amber },
                    ]}
                  >
                    {done} of {inputs.length}
                  </Text>
                )}
                {isCollapsed ? <CaretDown color={C.muted} size={16} /> : <CaretUp color={C.muted} size={16} />}
              </Pressable>
            )}
            {!isCollapsed &&
              g.items.map((item, ii) => (
                <View
                  key={item.id}
                  ref={(v) => {
                    if (v) itemRefs.current.set(item.id, v);
                    else itemRefs.current.delete(item.id);
                  }}
                  collapsable={false}
                  style={[(g.section || ii > 0) && st.itemDivider]}
                >
                  <Question
                    item={item}
                    answer={answers[item.id]}
                    missing={missingIds.has(item.id) && highlight.has(item.id)}
                    readOnly={!!readOnly}
                    commit={commit}
                    register={register}
                    bookingId={bookingId}
                    photos={photos}
                    onPhotosChanged={() => qc.invalidateQueries({ queryKey: ["photos", bookingId] })}
                  />
                </View>
              ))}
          </View>
        );
      })}
    </View>
  );
});

/* ------------------------------------------------------------------ */
/* save status                                                          */
/* ------------------------------------------------------------------ */

function SaveStatus({ bookingId, onRetry }: { bookingId: string; onRetry: (a: Answers) => void }) {
  const online = useIsOnline();
  const saves = useMutationState({
    filters: { mutationKey: jobFormSaveKey(bookingId) },
    select: (m) => ({
      status: m.state.status,
      paused: m.state.isPaused,
      vars: m.state.variables as Answers | undefined,
    }),
  });
  const pending = saves.filter((s) => s.status === "pending");
  let state: "idle" | "saving" | "offline" | "saved" | "error" = "idle";
  if (pending.length) state = !online && pending.some((s) => s.paused) ? "offline" : "saving";
  else if (saves.length) state = saves[saves.length - 1]!.status === "error" ? "error" : "saved";
  if (state === "idle" && !online) state = "offline";

  if (state === "idle") return null;
  if (state === "error") {
    // Re-send everything that failed since the last good save (same `at`, so
    // a stale one still can't beat a newer answer on the server).
    const failed: Answers[] = [];
    for (let i = saves.length - 1; i >= 0 && saves[i]!.status !== "success"; i--) {
      if (saves[i]!.status === "error" && saves[i]!.vars) failed.unshift(saves[i]!.vars!);
    }
    return (
      <Pressable
        onPress={() => failed.length && onRetry(combineAnswers(failed))}
        style={[st.savePill, { backgroundColor: C.redBg }]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Answer not saved. Tap to try again."
      >
        <ArrowClockwise color={C.red} size={12} weight="bold" />
        <Text style={[st.saveTxt, { color: C.red }]}>Not saved · retry</Text>
      </Pressable>
    );
  }
  const cfg = {
    saving: { icon: <ActivityIndicator color={C.sub} size="small" style={{ transform: [{ scale: 0.6 }] }} />, text: "Saving…", color: C.sub, bg: C.bg3 },
    offline: { icon: <CloudSlash color={C.amber} size={12} weight="bold" />, text: pending.length ? "Offline — will sync" : "Offline", color: C.amber, bg: C.amberBg },
    saved: { icon: <CloudCheck color={C.green} size={12} weight="bold" />, text: "Saved", color: C.green, bg: C.greenBg },
  }[state];
  return (
    <View style={[st.savePill, { backgroundColor: cfg.bg }]} accessibilityLiveRegion="polite" accessibilityLabel={cfg.text}>
      {cfg.icon}
      <Text style={[st.saveTxt, { color: cfg.color }]}>{cfg.text}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* one question                                                         */
/* ------------------------------------------------------------------ */

function Question(props: {
  item: FormItem;
  answer: Answer | undefined;
  missing: boolean;
  readOnly: boolean;
  commit: Commit;
  register: Register;
  bookingId: string;
  photos?: PhotoRef[];
  onPhotosChanged: () => void;
}) {
  const { item, answer, missing } = props;

  if (item.type === "instructions") {
    return (
      <View style={st.instructions}>
        <Info color={C.brand} size={16} weight="fill" style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 4 }}>
          {!!item.label && <Text style={st.instructionsTitle}>{item.label}</Text>}
          {!!item.help && <Text style={st.instructionsBody}>{item.help}</Text>}
        </View>
      </View>
    );
  }
  if (item.type === "section") return null;

  const flagged = isFlagged(item, answer);
  return (
    <View style={[st.item, missing && st.itemMissing]}>
      <View style={st.labelRow}>
        <Text style={st.label}>
          {item.label}
          {item.required ? <Text style={st.req}> *</Text> : null}
        </Text>
        {item.internal && (
          <View style={st.officeTag}>
            <Lock color={C.sub} size={10} weight="bold" />
            <Text style={st.officeTagTxt}>Office only</Text>
          </View>
        )}
        {flagged && (
          <View style={st.flagPill}>
            <Flag color={C.red} size={11} weight="fill" />
            <Text style={st.flagPillTxt}>Flagged</Text>
          </View>
        )}
      </View>
      {!!item.help && <Text style={st.help}>{item.help}</Text>}
      <Control {...props} flagged={flagged} />
      {missing && <Text style={st.missingTxt}>Required — answer this to finish the job</Text>}
    </View>
  );
}

function Control(props: Parameters<typeof Question>[0] & { flagged: boolean }) {
  const { item, answer, readOnly, commit } = props;
  const v = answer?.value ?? null;
  switch (item.type) {
    case "short_text":
    case "long_text":
    case "number":
    case "date":
    case "time":
      return <DraftField {...props} />;
    case "yes_no":
      return (
        <Segmented
          item={item}
          readOnly={readOnly}
          selected={typeof v === "string" ? v : null}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          onPick={(val) => commit(item, { value: val })}
        />
      );
    case "pass_fail":
      return (
        <Segmented
          item={item}
          readOnly={readOnly}
          selected={typeof v === "string" ? v : null}
          options={[
            { value: "pass", label: "Pass" },
            { value: "fail", label: "Fail" },
            { value: "na", label: "N/A" },
          ]}
          onPick={(val) => commit(item, { value: val })}
        />
      );
    case "single_choice":
      return choiceAsButtons(item) ? (
        <Segmented
          item={item}
          readOnly={readOnly}
          wrap
          selected={typeof v === "string" ? v : null}
          options={(item.options ?? []).map((o) => ({ value: o, label: o }))}
          onPick={(val) => commit(item, { value: val })}
        />
      ) : (
        <ChoicePicker item={item} readOnly={readOnly} selected={typeof v === "string" ? v : null} onPick={(val) => commit(item, { value: val })} />
      );
    case "multi_choice":
      return <MultiChips item={item} readOnly={readOnly} selected={Array.isArray(v) ? v : []} onChange={(vals) => commit(item, { value: vals })} />;
    case "checklist":
      return <Checklist item={item} readOnly={readOnly} selected={Array.isArray(v) ? v : []} onChange={(vals) => commit(item, { value: vals })} />;
    case "photo":
      return <PhotoAnswer {...props} />;
    case "signature":
      return <SignatureAnswer {...props} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* typed answers: text, number, date, time                              */
/* ------------------------------------------------------------------ */

function valueText(v: Answer["value"] | undefined): string {
  if (v === null || v === undefined) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

function DraftField({ item, answer, readOnly, commit, register }: Parameters<typeof Question>[0]) {
  const kind = item.type;
  const serverText = valueText(answer?.value);
  const [text, setText] = useState(serverText);
  const [focused, setFocused] = useState(false);
  const textRef = useRef(serverText);
  const dirty = useRef(false);
  const editedAt = useRef(new Date());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Take the server's value (office edit, another device) unless the tech is mid-edit.
  useEffect(() => {
    if (!dirty.current && !focused) {
      setText(serverText);
      textRef.current = serverText;
    }
  }, [serverText, focused]);

  const parse = useCallback(
    (t: string): Parsed<string | number> => {
      if (kind === "number") return parseNumberInput(t);
      if (kind === "date") return parseDateInput(t);
      if (kind === "time") return parseTimeInput(t);
      return { ok: true, value: t.trim() ? t : null };
    },
    [kind],
  );

  const flush = useCallback((): Answer | null => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return null;
    const p = parse(textRef.current);
    if (!p.ok) return null;
    dirty.current = false;
    if (p.value === (answer?.value ?? null)) return null;
    return commit(item, { value: p.value }, editedAt.current);
  }, [parse, commit, item, answer?.value]);

  // Let the form flush this field (before "Complete job"), and never lose a
  // draft when the field unmounts (section collapsed, question hidden).
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    register(item.id, () => flushRef.current());
    return () => {
      register(item.id, null);
      flushRef.current();
    };
  }, [item.id, register]);

  const change = (raw: string, immediate = false) => {
    const t = kind === "date" ? maskDate(raw) : kind === "time" ? maskTime(raw) : raw;
    setText(t);
    textRef.current = t;
    dirty.current = true;
    editedAt.current = new Date();
    if (timer.current) clearTimeout(timer.current);
    if (immediate) flushRef.current();
    else timer.current = setTimeout(() => flushRef.current(), 600);
  };

  const parsed = parse(text);
  const showError = !parsed.ok && (kind === "number" || !focused) && text.trim() !== "";
  const n = kind === "number" && parsed.ok ? (parsed.value as number | null) : null;
  const hint = kind === "number" ? numberHint(item) : "";
  const keyboard: KeyboardTypeOptions =
    kind === "number"
      ? item.min !== undefined && item.min >= 0
        ? "decimal-pad"
        : Platform.OS === "ios"
          ? "numbers-and-punctuation"
          : "numeric"
      : kind === "date" || kind === "time"
        ? "number-pad"
        : "default";
  const placeholder =
    kind === "date" ? "YYYY-MM-DD" : kind === "time" ? "HH:MM" : kind === "number" ? "0" : kind === "long_text" ? "Type your answer…" : "Answer";

  if (readOnly) {
    return (
      <Text style={[st.readValue, !serverText && { color: C.muted }]}>
        {serverText ? `${serverText}${kind === "number" && item.unit ? ` ${item.unit}` : ""}` : "Not answered"}
      </Text>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={st.inputRow}>
        <TextInput
          value={text}
          onChangeText={(t) => change(t)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            flushRef.current();
          }}
          placeholder={placeholder}
          placeholderTextColor={C.muted}
          keyboardType={keyboard}
          multiline={kind === "long_text"}
          textAlignVertical={kind === "long_text" ? "top" : "center"}
          maxLength={kind === "date" ? 10 : kind === "time" ? 5 : undefined}
          returnKeyType={kind === "long_text" ? "default" : "done"}
          style={[st.input, kind === "long_text" && st.inputMulti, showError && { borderColor: C.red }, { flex: 1 }]}
          accessibilityLabel={item.label}
          accessibilityHint={hint || (kind === "date" ? "Year, month, day" : kind === "time" ? "24-hour time" : undefined)}
        />
        {kind === "number" && !!item.unit && <Text style={st.unit}>{item.unit}</Text>}
        {(kind === "date" || kind === "time") && (
          <Pressable
            onPress={() => change(kind === "date" ? todayLocal() : nowLocal(), true)}
            style={st.quickBtn}
            accessibilityRole="button"
            accessibilityLabel={kind === "date" ? "Use today's date" : "Use the time now"}
          >
            <Text style={st.quickBtnTxt}>{kind === "date" ? "Today" : "Now"}</Text>
          </Pressable>
        )}
      </View>
      {showError ? (
        <Text style={st.errTxt}>{(parsed as { error: string }).error}</Text>
      ) : kind === "number" && outOfRange(item, n) ? (
        <Text style={st.warnTxt}>Outside the expected range ({hint.charAt(0).toLowerCase() + hint.slice(1)}) — double-check</Text>
      ) : hint ? (
        <Text style={st.hintTxt}>{hint}</Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* choices                                                              */
/* ------------------------------------------------------------------ */

function tap() {
  Haptics.selectionAsync().catch(() => {});
}

function Segmented({
  item,
  options,
  selected,
  onPick,
  readOnly,
  wrap,
}: {
  item: FormItem;
  options: { value: string; label: string }[];
  selected: string | null;
  onPick: (v: string | null) => void;
  readOnly: boolean;
  wrap?: boolean;
}) {
  return (
    <View style={[st.segRow, wrap && { flexWrap: "wrap" }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = selected === o.value;
        const bad = on && (item.flagOn ?? []).includes(o.value);
        return (
          <Pressable
            key={o.value}
            disabled={readOnly}
            onPress={() => {
              tap();
              // Tapping the chosen answer again clears it.
              onPick(on ? null : o.value);
            }}
            style={({ pressed }) => [
              st.segBtn,
              wrap ? st.segBtnWrap : { flex: 1 },
              on && st.segBtnOn,
              bad && st.segBtnBad,
              pressed && { opacity: 0.8 },
              readOnly && !on && { opacity: 0.5 },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: readOnly }}
            accessibilityLabel={o.label}
          >
            <Text style={[st.segTxt, on && st.segTxtOn, bad && { color: C.red }]} numberOfLines={2}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChoicePicker({
  item,
  selected,
  onPick,
  readOnly,
}: {
  item: FormItem;
  selected: string | null;
  onPick: (v: string | null) => void;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bad = !!selected && (item.flagOn ?? []).includes(selected);
  return (
    <>
      <Pressable
        disabled={readOnly}
        onPress={() => setOpen(true)}
        style={[st.input, st.pickerBtn, bad && st.segBtnBad]}
        accessibilityRole="button"
        accessibilityLabel={`${item.label}: ${selected ?? "not chosen"}. Tap to choose.`}
      >
        <Text style={[st.pickerTxt, !selected && { color: C.muted }, bad && { color: C.red }]} numberOfLines={1}>
          {selected ?? (readOnly ? "Not answered" : "Choose…")}
        </Text>
        {!readOnly && <CaretDown color={C.sub} size={16} />}
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>{item.label}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {(item.options ?? []).map((o) => {
                const on = o === selected;
                return (
                  <Pressable
                    key={o}
                    onPress={() => {
                      tap();
                      onPick(o);
                      setOpen(false);
                    }}
                    style={[st.optRow, on && st.optRowOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={o}
                  >
                    <Text style={[st.optTxt, on && { color: C.text }]}>{o}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {selected && (
                <Pressable
                  onPress={() => {
                    onPick(null);
                    setOpen(false);
                  }}
                  style={[st.sheetBtn, { flex: 1 }]}
                  accessibilityRole="button"
                >
                  <Text style={st.sheetBtnTxt}>Clear</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setOpen(false)} style={[st.sheetBtn, { flex: 1 }]} accessibilityRole="button">
                <Text style={st.sheetBtnTxt}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function toggleIn(options: string[], selected: string[], o: string): string[] {
  const set = new Set(selected);
  if (set.has(o)) set.delete(o);
  else set.add(o);
  // keep the form's own order
  return options.filter((x) => set.has(x));
}

function MultiChips({
  item,
  selected,
  onChange,
  readOnly,
}: {
  item: FormItem;
  selected: string[];
  onChange: (v: string[]) => void;
  readOnly: boolean;
}) {
  const options = item.options ?? [];
  return (
    <View style={st.chipRow}>
      {options.map((o) => {
        const on = selected.includes(o);
        const bad = on && (item.flagOn ?? []).includes(o);
        return (
          <Pressable
            key={o}
            disabled={readOnly}
            onPress={() => {
              tap();
              onChange(toggleIn(options, selected, o));
            }}
            style={[st.chip, on && st.segBtnOn, bad && st.segBtnBad, readOnly && !on && { opacity: 0.5 }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: readOnly }}
            accessibilityLabel={o}
          >
            <Text style={[st.segTxt, on && st.segTxtOn, bad && { color: C.red }]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Checklist({
  item,
  selected,
  onChange,
  readOnly,
}: {
  item: FormItem;
  selected: string[];
  onChange: (v: string[]) => void;
  readOnly: boolean;
}) {
  const options = item.options ?? [];
  const done = options.filter((o) => selected.includes(o)).length;
  return (
    <View>
      <Text style={[st.hintTxt, { marginBottom: 2 }, done === options.length && options.length > 0 && { color: C.green }]}>
        {done} of {options.length} done
      </Text>
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <Pressable
            key={o}
            disabled={readOnly}
            onPress={() => {
              tap();
              onChange(toggleIn(options, selected, o));
            }}
            style={st.checkRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: readOnly }}
            accessibilityLabel={o}
          >
            {on ? <CheckSquare color={C.green} size={24} weight="fill" /> : <Square color={C.sub} size={24} />}
            <Text style={[st.checkTxt, on && { color: C.muted, textDecorationLine: "line-through" }]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* photos                                                               */
/* ------------------------------------------------------------------ */

function PhotoAnswer({ item, answer, readOnly, commit, bookingId, photos, onPhotosChanged }: Parameters<typeof Question>[0]) {
  const ids = answer?.photoIds ?? [];
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const min = item.minPhotos ?? 0;
  const max = item.maxPhotos;

  const urlFor = (id: string) => localUrls[id] ?? photos?.find((p) => p.id === id)?.url;
  // Shots for this question that haven't reached the server yet. They're kept
  // on the phone and sent again by themselves; when one lands the server adds
  // it to this answer, and if this screen is still open it adds it here too.
  const waiting = usePendingPhotos(bookingId, item.id);
  // Photos still waiting to upload count toward the question's limit, or one
  // added meanwhile would fill it and the waiting one couldn't be attached.
  const full = max !== undefined && ids.length + waiting.length >= max;
  useEffect(
    () =>
      onPhotoUploaded((p, photo) => {
        if (p.bookingId !== bookingId || p.formItemId !== item.id || !photo?.id) return;
        if (photo.url) setLocalUrls((m) => ({ ...m, [photo.id]: String(photo.url) }));
        // (the server has already added it; this keeps the open screen in step)
        if (!readOnly && !idsRef.current.includes(photo.id)) commit(item, { photoIds: [...idsRef.current, photo.id] });
        onPhotosChanged();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookingId, item.id],
  );

  async function take(source: PhotoSource) {
    const asset = await pickPhoto(source, "attach photos to this question");
    if (!asset) return;
    const tappedAt = new Date();
    setBusy(true);
    try {
      const r = await addJobPhoto({
        bookingId,
        asset,
        phase: "during",
        caption: item.label,
        formItemId: item.id,
        // an office-only question's photo stays office-only
        customerVisible: item.internal ? false : undefined,
      });
      const photo = r.photo;
      if (photo?.id) {
        if (photo.url) setLocalUrls((m) => ({ ...m, [photo.id]: String(photo.url) }));
        commit(item, { photoIds: [...idsRef.current, photo.id] }, tappedAt);
        onPhotosChanged();
      } else if (r.lost) {
        Alert.alert(
          "Photo not uploaded",
          `It couldn't upload${r.error ? ` (${r.error})` : ""} and there wasn't room to keep it on this phone. Please take it again.`,
        );
      } else {
        Alert.alert(
          "Photo saved on this phone",
          `It couldn't upload just now${r.error ? ` (${r.error})` : ""}. It will upload by itself and be added to this question.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function waitingActions(p: PendingPhoto) {
    Alert.alert(
      p.stuck ? "This photo wasn't accepted" : "This photo hasn't uploaded yet",
      p.lastError ? `Last try: ${p.lastError}` : "It's saved on this phone and will upload by itself.",
      [
        { text: "Retry now", onPress: () => void retryPendingPhoto(p.clientId) },
        { text: "Discard", style: "destructive", onPress: () => discardPendingPhoto(p.clientId) },
        { text: "Close", style: "cancel" },
      ],
    );
  }

  function add() {
    choosePhotoSource(take);
  }

  function remove(id: string) {
    Alert.alert("Remove this photo from the question?", "It stays in the job's photos.", [
      { text: "Keep", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => commit(item, { photoIds: idsRef.current.filter((x) => x !== id) }) },
    ]);
  }

  const need = Math.max(min, 0);
  return (
    <View style={{ gap: 8 }}>
      <Text style={[st.hintTxt, need > 0 && ids.length >= need && { color: C.green }]}>
        {ids.length} photo{ids.length === 1 ? "" : "s"}
        {need > 0 ? ` · min ${need}` : ""}
        {max !== undefined ? ` · max ${max}` : ""}
      </Text>
      <View style={st.thumbRow}>
        {ids.map((id) => {
          const url = urlFor(id);
          return (
            <View key={id} style={st.thumbWrap}>
              {url ? <Image source={{ uri: assetUrl(url) }} style={st.thumb} /> : <View style={[st.thumb, st.thumbEmpty]} />}
              {!readOnly && (
                <Pressable onPress={() => remove(id)} style={st.thumbX} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove photo">
                  <X color="#fff" size={12} weight="bold" />
                </Pressable>
              )}
            </View>
          );
        })}
        {waiting.map((p) => (
          <Pressable
            key={p.clientId}
            onPress={() => waitingActions(p)}
            style={st.thumbWrap}
            accessibilityRole="button"
            accessibilityLabel={`${pendingLabel(p)}. Tap for options`}
          >
            <Image source={{ uri: p.uri }} style={[st.thumb, { opacity: 0.6 }]} />
            <View style={[st.waitBadge, p.stuck && { backgroundColor: C.red }]}>
              <Text style={st.waitBadgeTxt}>{pendingLabel(p)}</Text>
            </View>
          </Pressable>
        ))}
        {!readOnly && !full && (
          <Pressable
            onPress={add}
            disabled={busy}
            style={[st.thumb, st.addPhoto]}
            accessibilityRole="button"
            accessibilityLabel={`Add photo for ${item.label}`}
          >
            {busy ? (
              <ActivityIndicator color={C.brand} size="small" />
            ) : (
              <>
                <Camera color={C.brand} size={22} weight="fill" />
                <Text style={st.addPhotoTxt}>Add photo</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* signature                                                            */
/* ------------------------------------------------------------------ */

function SignaturePreview({ src }: { src: string }) {
  const [w, setW] = useState(0);
  const parsed = useMemo(() => signatureStrokes(src), [src]);
  const H = 110;
  if (!parsed) {
    // PNG / hosted image: an <Image> can show it. (SVG can't be drawn by RN's Image.)
    if (/^data:image\/(png|jpe?g)|^https?:\/\/|^\/uploads\//.test(src) && !/\.svg($|\?)/.test(src)) {
      return <Image source={{ uri: assetUrl(src) ?? src }} style={[st.sigBox, { height: H }]} resizeMode="contain" />;
    }
    return (
      <View style={[st.sigBox, { height: H, alignItems: "center", justifyContent: "center" }]}>
        <Signature color="#475569" size={28} />
      </View>
    );
  }
  const scale = w ? Math.min(w / parsed.width, H / parsed.height) : 0;
  const offX = w ? (w - parsed.width * scale) / 2 : 0;
  const offY = (H - parsed.height * scale) / 2;
  return (
    <View style={[st.sigBox, { height: H }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityLabel="Captured signature">
      {scale > 0 &&
        parsed.strokes.map((s, si) =>
          s.slice(1).map((p, i) => {
            const a = s[i]!;
            return (
              <Segment
                key={`${si}-${i}`}
                a={[offX + (a[0] ?? 0) * scale, offY + (a[1] ?? 0) * scale]}
                b={[offX + (p[0] ?? 0) * scale, offY + (p[1] ?? 0) * scale]}
                color="#0f172a"
              />
            );
          }),
        )}
    </View>
  );
}

function SignatureAnswer({ item, answer, readOnly, commit }: Parameters<typeof Question>[0]) {
  const [open, setOpen] = useState(false);
  const value = typeof answer?.value === "string" ? answer.value : null;
  const who = item.signer === "technician" ? "Technician signs" : "Customer signs";
  return (
    <View style={{ gap: 8 }}>
      {value ? (
        <>
          <SignaturePreview src={value} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <Text style={st.sigMeta} numberOfLines={1}>
              Signed{answer?.name ? ` by ${answer.name}` : ""}
            </Text>
            {!readOnly && (
              <Pressable onPress={() => setOpen(true)} style={st.quickBtn} accessibilityRole="button" accessibilityLabel="Sign again">
                <Text style={st.quickBtnTxt}>Re-sign</Text>
              </Pressable>
            )}
          </View>
        </>
      ) : readOnly ? (
        <Text style={[st.readValue, { color: C.muted }]}>Not signed</Text>
      ) : (
        <Pressable onPress={() => setOpen(true)} style={st.signBtn} accessibilityRole="button" accessibilityLabel={`${item.label}. ${who}. Tap to sign.`}>
          <Signature color={C.brand} size={20} weight="fill" />
          <Text style={st.signBtnTxt}>Tap to sign</Text>
          <Text style={st.signBtnSub}>{who}</Text>
        </Pressable>
      )}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={st.sheetWrap}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>{item.label}</Text>
            <Text style={st.sheetSub}>{who} with a finger, then print the name.</Text>
            <SignaturePad
              colors={{ bg: C.bg, card: C.bg3, text: C.text, muted: C.muted, brand: C.brand, line: C.border }}
              onSubmit={async ({ strokes, width, height, name }) => {
                const url = strokesToSignatureDataUrl(strokes, width, height);
                if (!url) {
                  Alert.alert("Signature too detailed", "Clear it and sign once more.");
                  return;
                }
                commit(item, { value: url, name });
                setOpen(false);
              }}
            />
            <Pressable onPress={() => setOpen(false)} style={st.sheetBtn} accessibilityRole="button">
              <Text style={st.sheetBtnTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const st = StyleSheet.create({
  wrap: { gap: 12, marginTop: 12 },
  headCard: {
    backgroundColor: C.card,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headTitle: { color: C.text, fontSize: 15, fontWeight: "800", flex: 1 },
  barTrack: { height: 8, borderRadius: R.pill, backgroundColor: C.bg3, overflow: "hidden" },
  barFill: { height: 8, borderRadius: R.pill, backgroundColor: C.brand },
  headMeta: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  headCount: { color: C.text, fontSize: 13, fontWeight: "700" },
  headMissing: { color: C.amber, fontSize: 12, fontWeight: "700" },
  readOnlyNote: { color: C.muted, fontSize: 12 },
  savePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: R.pill, minHeight: 24 },
  saveTxt: { fontSize: 11, fontWeight: "700" },
  flagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: C.redBg,
  },
  flagPillTxt: { color: C.red, fontSize: 11, fontWeight: "800" },

  sectionCard: {
    backgroundColor: C.card,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingVertical: 8 },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  sectionHelp: { color: C.sub, fontSize: 12, marginTop: 2, lineHeight: 17 },
  sectionCount: { color: C.sub, fontSize: 12, fontWeight: "700" },
  itemDivider: { borderTopWidth: 1, borderTopColor: C.border },

  item: { paddingVertical: 14, gap: 8 },
  itemMissing: {
    borderLeftWidth: 3,
    borderLeftColor: C.red,
    paddingLeft: 10,
    marginLeft: -13,
  },
  labelRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  label: { color: C.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  req: { color: C.red, fontWeight: "900" },
  help: { color: C.sub, fontSize: 13, lineHeight: 18, marginTop: -2 },
  officeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.borderHi,
  },
  officeTagTxt: { color: C.sub, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  missingTxt: { color: C.red, fontSize: 12, fontWeight: "700" },

  instructions: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(14,165,233,0.08)",
    borderRadius: R.control,
    padding: 12,
    marginVertical: 10,
  },
  instructionsTitle: { color: C.brand, fontSize: 13, fontWeight: "800" },
  instructionsBody: { color: C.text, fontSize: 13, lineHeight: 20 },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    minHeight: 48,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.borderHi,
    backgroundColor: C.bg3,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputMulti: { minHeight: 96, paddingTop: 12 },
  unit: { color: C.sub, fontSize: 15, fontWeight: "700", minWidth: 24 },
  quickBtn: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 12,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtnTxt: { color: C.brand, fontSize: 14, fontWeight: "800" },
  readValue: { color: C.text, fontSize: 15 },
  hintTxt: { color: C.muted, fontSize: 12, fontWeight: "600" },
  warnTxt: { color: C.amber, fontSize: 12, fontWeight: "700" },
  errTxt: { color: C.red, fontSize: 12, fontWeight: "700" },

  segRow: { flexDirection: "row", gap: 8 },
  segBtn: {
    minHeight: 52,
    borderRadius: R.control,
    borderWidth: 1.5,
    borderColor: C.borderHi,
    backgroundColor: C.bg3,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  segBtnWrap: { minWidth: "30%", flexGrow: 1 },
  segBtnOn: { borderColor: C.brand, backgroundColor: "rgba(14,165,233,0.16)" },
  segBtnBad: { borderColor: C.red, backgroundColor: C.redBg },
  segTxt: { color: C.sub, fontSize: 15, fontWeight: "700", textAlign: "center" },
  segTxtOn: { color: C.text, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    borderRadius: R.pill,
    borderWidth: 1.5,
    borderColor: C.borderHi,
    backgroundColor: C.bg3,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  pickerTxt: { color: C.text, fontSize: 16, flex: 1 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 6 },
  checkTxt: { color: C.text, fontSize: 15, flex: 1 },

  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  thumbWrap: { position: "relative" },
  thumb: { width: 84, height: 84, borderRadius: R.control, backgroundColor: C.bg3 },
  thumbEmpty: { borderWidth: 1, borderColor: C.border },
  waitBadge: {
    position: "absolute",
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 6,
    paddingVertical: 2,
    backgroundColor: "rgba(7,11,18,0.85)",
    alignItems: "center",
  },
  waitBadgeTxt: { color: "#fff", fontSize: 8, fontWeight: "800" },
  thumbX: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.9)",
    borderWidth: 1,
    borderColor: C.borderHi,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: C.brand,
    backgroundColor: "rgba(14,165,233,0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addPhotoTxt: { color: C.brand, fontSize: 11, fontWeight: "800" },

  sigBox: { borderRadius: R.control, backgroundColor: "#ffffff", overflow: "hidden", width: "100%" },
  sigMeta: { color: C.sub, fontSize: 13, fontWeight: "600", flex: 1 },
  signBtn: {
    minHeight: 72,
    borderRadius: R.control,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: C.brand,
    backgroundColor: "rgba(14,165,233,0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 10,
  },
  signBtnTxt: { color: C.brand, fontSize: 15, fontWeight: "800" },
  signBtnSub: { color: C.sub, fontSize: 12 },

  sheetWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.bg2,
    borderTopLeftRadius: R.sheet,
    borderTopRightRadius: R.sheet,
    borderTopWidth: 1,
    borderColor: C.border,
    padding: 20,
    paddingBottom: 34,
    gap: 12,
  },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: "900" },
  sheetSub: { color: C.sub, fontSize: 13, lineHeight: 19, marginTop: -6 },
  sheetBtn: {
    minHeight: 48,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBtnTxt: { color: C.sub, fontSize: 15, fontWeight: "800" },
  optRow: {
    minHeight: 50,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  optRowOn: { borderColor: C.brand, backgroundColor: "rgba(14,165,233,0.12)" },
  optTxt: { color: C.sub, fontSize: 15, fontWeight: "700" },
});

