import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Trash } from "phosphor-react-native";
import Constants from "expo-constants";
import { authHeaders } from "../lib/auth";
import { C, R, assetUrl } from "../lib/theme";
import { playVoiceNote, type Playback } from "../lib/voice-note";
import { throwIfNotOk } from "../lib/api-error";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

type Note = { id: string; url: string; durationSecs: number; transcript: string; createdAt: string | number };

const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;

/**
 * The voice notes the signed-in technician recorded on this job: play each one
 * back, or delete it (the recording, its timeline entry and the transcript line
 * it added to the field notes). Only their own; the server decides which.
 */
export function MyVoiceNotes({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const notesKey = ["voice-notes", bookingId];
  const q = useQuery({
    queryKey: notesKey,
    queryFn: async () => {
      const res = await fetch(`${API}/api/bookings/${bookingId}/voice-notes`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Couldn't load voice notes");
      return ((await res.json()) as { notes: Note[] }).notes;
    },
  });

  const [playingId, setPlayingId] = useState<string | null>(null);
  const playback = useRef<Playback | null>(null);
  const stop = () => {
    playback.current?.stop();
    playback.current = null;
    setPlayingId(null);
  };
  // Leaving the screen mid-playback shouldn't leave it talking.
  useEffect(() => () => playback.current?.stop(), []);

  async function toggle(n: Note) {
    if (playingId === n.id) return stop();
    stop();
    setPlayingId(n.id);
    const p = await playVoiceNote(assetUrl(n.url) ?? n.url, () => {
      playback.current = null;
      setPlayingId(null);
    });
    if (!p) {
      setPlayingId(null);
      Alert.alert("Couldn't play it", "Try again in a moment.");
      return;
    }
    playback.current = p;
  }

  const del = useMutation({
    mutationFn: async (n: Note) => {
      const res = await fetch(`${API}/api/bookings/${bookingId}/voice-notes/${n.id}`, { method: "DELETE", headers: authHeaders() });
      await throwIfNotOk(res, "Couldn't delete it");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notesKey });
      // The job's field notes lost its transcript line.
      qc.invalidateQueries({ queryKey: ["job", bookingId] });
    },
    onError: (e: any) => Alert.alert("Couldn't delete it", e?.message || "Try again"),
  });

  function confirmDelete(n: Note) {
    Alert.alert("Delete this voice note?", "The recording and its transcript are removed from the job, including your field notes.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          if (playingId === n.id) stop();
          del.mutate(n);
        },
      },
    ]);
  }

  const notes = q.data ?? [];
  if (!notes.length) return null;
  return (
    <View style={st.list}>
      {notes.map((n, i) => {
        const playing = playingId === n.id;
        const deleting = del.isPending && del.variables?.id === n.id;
        return (
          <View key={n.id} style={st.row}>
            <Pressable
              onPress={() => toggle(n)}
              style={st.play}
              accessibilityRole="button"
              accessibilityLabel={playing ? `Pause voice note ${i + 1}` : `Play voice note ${i + 1}`}
            >
              {playing ? <Pause color={C.brand} size={18} weight="fill" /> : <Play color={C.brand} size={18} weight="fill" />}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={st.meta}>
                Voice note {i + 1}
                {n.durationSecs ? ` · ${clock(n.durationSecs)}` : ""}
              </Text>
              {!!n.transcript && (
                <Text style={st.transcript} numberOfLines={2}>
                  {n.transcript}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => confirmDelete(n)}
              disabled={deleting}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Delete voice note ${i + 1}`}
            >
              {deleting ? <ActivityIndicator color={C.red} size="small" /> : <Trash color={C.red} size={18} />}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  list: { gap: 8, marginTop: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.bg3,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
  },
  play: { width: 36, height: 36, borderRadius: R.pill, alignItems: "center", justifyContent: "center", backgroundColor: C.bg2 },
  meta: { color: C.text, fontSize: 13, fontWeight: "700" },
  transcript: { color: C.sub, fontSize: 12, marginTop: 2 },
});
