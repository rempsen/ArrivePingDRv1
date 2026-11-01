import { useEffect, useId, useRef, useState } from "react";
import { describeSms, generateTexts, OMW_DEFAULTS, TONES, TRADES, type OmwInput, type OmwTexts, type Tone, type TradeKey } from "../tools/omw-text";

/**
 * The on-my-way text generator. Runs entirely in the browser: no form, no
 * network request, nothing stored. The first render uses OMW_DEFAULTS, so the
 * prerendered HTML already shows a full set of texts.
 */
export function OmwTextGenerator() {
  const id = useId();
  const [input, setInput] = useState<OmwInput>(OMW_DEFAULTS);
  // The ETA field keeps what was typed (even "" mid-edit); the texts use the cleaned number.
  const [etaText, setEtaText] = useState(String(OMW_DEFAULTS.eta));
  const texts = generateTexts(input);
  const set = <K extends keyof OmwInput>(k: K, v: OmwInput[K]) => setInput((p) => ({ ...p, [k]: v }));

  const cards: { key: keyof OmwTexts; title: string; when: string }[] = [
    { key: "onMyWay", title: "On my way", when: "Send when the tech leaves for the job." },
    { key: "runningLate", title: "Running late", when: "Send as soon as you know the time will slip." },
    { key: "arrived", title: "Arrived", when: "Send at the door, or skip it if they knock first." },
  ];

  return (
    <div className="geo-tool">
      <fieldset className="geo-tool__inputs">
        <legend className="geo-tool__h">Your details</legend>
        <div className="geo-field">
          <label htmlFor={`${id}-trade`} id={`${id}-trade-l`}>
            Trade or business type
          </label>
          <select id={`${id}-trade`} aria-labelledby={`${id}-trade-l`} value={input.trade} onChange={(e) => set("trade", e.target.value as TradeKey)}>
            {TRADES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="geo-field geo-field--tones">
          <legend>Tone</legend>
          <div className="geo-seg">
            {TONES.map((t) => (
              <label key={t.key} className="geo-seg__opt" id={`${id}-tone-${t.key}`}>
                <input
                  type="radio"
                  name={`${id}-tone`}
                  value={t.key}
                  checked={input.tone === t.key}
                  onChange={() => set("tone", t.key as Tone)}
                  aria-labelledby={`${id}-tone-${t.key}`}
                />
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="geo-field">
          <label htmlFor={`${id}-co`} id={`${id}-co-l`}>
            Company name
          </label>
          <input id={`${id}-co`} aria-labelledby={`${id}-co-l`} type="text" autoComplete="organization" maxLength={60} value={input.company} onChange={(e) => set("company", e.target.value)} />
        </div>
        <div className="geo-field-row">
          <div className="geo-field">
            <label htmlFor={`${id}-tech`} id={`${id}-tech-l`}>
              Technician's first name
            </label>
            <input id={`${id}-tech`} aria-labelledby={`${id}-tech-l`} type="text" autoComplete="off" maxLength={40} value={input.tech} onChange={(e) => set("tech", e.target.value)} />
          </div>
          <div className="geo-field">
            <label htmlFor={`${id}-eta`} id={`${id}-eta-l`}>
              ETA (minutes)
            </label>
            <input
              id={`${id}-eta`}
              aria-labelledby={`${id}-eta-l`}
              type="number"
              inputMode="numeric"
              min={1}
              max={240}
              step={1}
              value={etaText}
              onChange={(e) => {
                setEtaText(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 1) set("eta", n);
              }}
            />
          </div>
        </div>
        <div className="geo-checks">
          <label className="geo-check" id={`${id}-link-l`}>
            <input type="checkbox" checked={input.link} onChange={(e) => set("link", e.target.checked)} aria-labelledby={`${id}-link-l`} />
            <span>Add a live tracking link placeholder</span>
          </label>
          <label className="geo-check" id={`${id}-stop-l`}>
            <input type="checkbox" checked={input.optOut} onChange={(e) => set("optOut", e.target.checked)} aria-labelledby={`${id}-stop-l`} />
            <span>Add "Reply STOP to opt out."</span>
          </label>
        </div>
        <p className="geo-tool__fine">Runs in your browser. Nothing you type is saved or sent anywhere.</p>
      </fieldset>

      <div className="geo-tool__out" aria-live="polite">
        {cards.map((c) => (
          <TextCard key={c.key} title={c.title} when={c.when} text={texts[c.key]} />
        ))}
      </div>
    </div>
  );
}

function TextCard({ title, when, text }: { title: string; when: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const onCopy = async () => {
    const ok = await copyText(text);
    setCopied(ok);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="geo-sms">
      <div className="geo-sms__head">
        <h3 className="geo-sms__title">{title}</h3>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCopy} aria-label={`Copy the ${title.toLowerCase()} text`}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="geo-sms__when">{when}</p>
      <p className="geo-sms__bubble">{text}</p>
      <p className="geo-sms__meta">
        {describeSms(text)}
        <output className="visually-hidden">{copied ? `${title} text copied to the clipboard` : ""}</output>
      </p>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection fallback (older Safari, non-secure contexts).
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
