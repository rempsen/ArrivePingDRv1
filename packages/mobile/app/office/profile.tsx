import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { ArrowLeft, SignOut, FileText, ShieldCheck, Lifebuoy, CaretRight, Wrench, Browser, Sparkle } from "phosphor-react-native";
import { authClient, clearToken } from "../../lib/auth";
import { unregisterPushToken } from "../../lib/push";
import { endAllLiveActivities } from "../../lib/useLiveActivity";
import { C, R, S, WIDE } from "../../lib/theme";
import { Avatar, Card, Button, Row } from "../../components/ui";
import { isBiometricAvailable, getLockPreference, setLockPreference, clearUnlockStamp } from "../../lib/biometric-lock";
import { clearActiveCompany, getActiveCompany, setActiveCompany } from "../../lib/active-company";
import { useMyCompanies } from "../../lib/my-companies";
import { useAccess } from "../../lib/use-access";
import { resolveMode } from "../../lib/app-mode";
import { getSavedMode, setSavedMode } from "../../lib/app-mode-store";
import { webUrl } from "../../lib/office-nav";
import { disconnectCalendar } from "../../lib/calendar-sync";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");
const APP_VERSION = Constants.expoConfig?.version ?? "1.0";

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Super admin",
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  project_manager: "Project manager",
};

/**
 * Office Profile: which company this phone is dispatching for, the switch to
 * field mode for an owner who also runs calls, the lock setting, and sign
 * out. No headshot upload or availability toggle — those belong to a
 * technician's record, which office mode never touches.
 */
export default function OfficeProfile() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const { access } = useAccess();
  const [activeCompany, setActiveCompanyState] = useState(getActiveCompany());
  const myCompanies = useMyCompanies();
  const companies = myCompanies.data?.companies ?? [];
  const current = companies.find((c) => c.id === activeCompany) ?? (companies.length === 1 ? companies[0] : undefined);
  const mode = current ? resolveMode({ role: current.role, staffType: current.staffType, saved: getSavedMode() }) : null;

  const biometric = useQuery({
    queryKey: ["biometric-lock"],
    queryFn: async () => ({ available: await isBiometricAvailable(), enabled: await getLockPreference() }),
    staleTime: Infinity,
  });
  const toggleBiometric = useMutation({
    mutationFn: async (enabled: boolean) => {
      await setLockPreference(enabled);
      return enabled;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["biometric-lock"] }),
  });

  const switching = useMutation({
    mutationFn: async (companyId: string) => {
      await setActiveCompany(companyId);
      return companyId;
    },
    onSuccess: (companyId) => {
      setActiveCompanyState(companyId);
      qc.clear();
      const co = companies.find((c) => c.id === companyId);
      const next = co ? resolveMode({ role: co.role, staffType: co.staffType, saved: getSavedMode() }).mode : "office";
      router.replace(next === "office" ? "/(office)" : "/(rider)");
    },
    onError: () => Alert.alert("Couldn't switch", "Check your connection and try again."),
  });

  async function toField() {
    await setSavedMode("field");
    qc.clear();
    router.replace("/(rider)");
  }

  async function leaveDevice() {
    await unregisterPushToken().catch(() => {});
    await endAllLiveActivities().catch(() => {});
    // A dual-role tech may have turned on calendar sync in field mode; their
    // synced jobs (customer names, addresses) leave the phone with them.
    await disconnectCalendar({ removeEvents: true }).catch(() => {});
    await clearUnlockStamp().catch(() => {});
    await clearActiveCompany().catch(() => {});
    await authClient.signOut().catch(() => {});
    try {
      await clearToken();
    } catch {
      /* token store unavailable — the server-side session is already gone */
    }
    qc.clear();
    router.replace("/sign-in");
  }

  function signOut() {
    Alert.alert("Sign out", "End your session?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: leaveDevice },
    ]);
  }

  function openLink(path: string) {
    Linking.openURL(`${API}${path}`).catch(() => Alert.alert("Couldn't open link", `${API}${path}`));
  }

  const user = session?.user as { name?: string; email?: string; image?: string | null } | undefined;
  const role = current?.role ?? access?.role ?? "";

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <View style={[s.topBar, WIDE]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft color={C.text} size={22} />
        </Pressable>
        <Text style={s.topTitle}>Profile</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={[s.content, WIDE]}>
        <View style={s.hero}>
          <Avatar name={user?.name} photoUrl={user?.image} size={64} />
          <Text style={s.name}>{user?.name ?? "Office"}</Text>
          <Text style={s.sub}>{user?.email}</Text>
          <View style={s.rolePill}>
            <Text style={s.roleTxt}>{ROLE_LABEL[role] ?? role}</Text>
          </View>
        </View>

        {mode?.canSwitch ? (
          <Card>
            <Text style={s.cardTitle}>Field mode</Text>
            <Text style={s.hint}>You also run calls here. Switch to see your own jobs, go on shift and share your location.</Text>
            <Button title="Switch to field mode" variant="outline" icon={<Wrench color={C.text} size={18} />} onPress={toField} style={{ marginTop: S.md }} />
          </Card>
        ) : null}

        {companies.length > 1 ? (
          <Card>
            <Text style={s.cardTitle}>Working for</Text>
            <Text style={s.hint}>Switching reloads the board for that company.</Text>
            <View style={{ gap: S.sm, marginTop: S.md }}>
              {companies.map((co) => {
                const isActive = co.id === activeCompany;
                return (
                  <Pressable
                    key={co.id}
                    disabled={isActive || switching.isPending}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                      switching.mutate(co.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${co.name}`}
                    accessibilityState={{ selected: isActive }}
                    style={[s.coRow, isActive && s.coRowActive]}
                  >
                    <View style={s.coAvatar}>
                      <Text style={s.coAvatarTxt}>{co.name?.[0]?.toUpperCase() ?? "?"}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.coName} numberOfLines={1}>
                        {co.name}
                      </Text>
                      <Text style={s.coRole}>{isActive ? "Current" : (ROLE_LABEL[co.role] ?? co.role)}</Text>
                    </View>
                    {switching.isPending && switching.variables === co.id ? <ActivityIndicator color={C.brand} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        {biometric.data?.available ? (
          <Card>
            <View style={s.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>Lock with Face ID</Text>
                <Text style={s.hint}>{biometric.data.enabled ? "Asks once a day when the app opens." : "Off. Anyone with the phone can open the board."}</Text>
              </View>
              <Pressable
                onPress={() => toggleBiometric.mutate(!biometric.data!.enabled)}
                style={[s.toggle, biometric.data.enabled && s.toggleOn]}
                accessibilityRole="switch"
                accessibilityLabel="Lock with Face ID"
                accessibilityState={{ checked: biometric.data.enabled, busy: toggleBiometric.isPending }}
              >
                <View style={[s.knob, biometric.data.enabled && s.knobOn]} />
              </Pressable>
            </View>
          </Card>
        ) : null}

        <Card>
          <Text style={s.cardTitle}>Details</Text>
          <Row label="Role" value={ROLE_LABEL[role] ?? role} />
          <Row label="Company" value={current?.name} />
          <Row label="Permissions" value={access ? (access.permissions.includes("*") ? "Everything" : `${access.permissions.length} granted`) : undefined} />
        </Card>

        <Card>
          <Pressable onPress={() => router.push("/help")} style={s.linkRow} accessibilityRole="button" accessibilityLabel="Ask ArrivePing">
            <Sparkle color={C.brand} size={18} weight="fill" />
            <Text style={s.linkTxt}>Ask ArrivePing</Text>
            <CaretRight color={C.muted} size={16} />
          </Pressable>
          <Pressable onPress={() => Linking.openURL(webUrl("/admin")).catch(() => {})} style={s.linkRow} accessibilityRole="link" accessibilityLabel="Open the web console">
            <Browser color={C.sub} size={18} />
            <Text style={s.linkTxt}>Open the web console</Text>
            <CaretRight color={C.muted} size={16} />
          </Pressable>
          {(
            [
              { label: "Privacy Policy", path: "/privacy", Icon: ShieldCheck },
              { label: "Terms of Service", path: "/terms", Icon: FileText },
              { label: "Help & Support", path: "/support", Icon: Lifebuoy },
            ] as const
          ).map(({ label, path, Icon }) => (
            <Pressable key={path} onPress={() => openLink(path)} style={s.linkRow} accessibilityRole="link" accessibilityLabel={label}>
              <Icon color={C.sub} size={18} />
              <Text style={s.linkTxt}>{label}</Text>
              <CaretRight color={C.muted} size={16} />
            </Pressable>
          ))}
        </Card>

        <Button title="Sign out" variant="danger" icon={<SignOut color="#fff" size={18} weight="bold" />} onPress={signOut} />
        <Text style={s.foot}>ArrivePing Office · v{APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: S.lg, paddingVertical: S.md },
  topTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  content: { padding: S.lg, gap: S.md, paddingBottom: S.xxl },
  hero: { alignItems: "center", gap: 4, paddingVertical: S.md },
  name: { color: C.text, fontSize: 20, fontWeight: "800", marginTop: S.sm },
  sub: { color: C.sub, fontSize: 13 },
  rolePill: { marginTop: S.sm, backgroundColor: "rgba(14,165,233,0.16)", borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 },
  roleTxt: { color: C.brand, fontSize: 12, fontWeight: "800" },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "800", marginBottom: 4 },
  hint: { color: C.sub, fontSize: 13, lineHeight: 18 },
  coRow: { flexDirection: "row", alignItems: "center", gap: S.md, padding: S.md, borderRadius: R.control, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  coRowActive: { borderColor: C.brand },
  coAvatar: { width: 36, height: 36, borderRadius: R.pill, backgroundColor: C.bg2, alignItems: "center", justifyContent: "center" },
  coAvatarTxt: { color: C.text, fontWeight: "800" },
  coName: { color: C.text, fontSize: 14, fontWeight: "700" },
  coRole: { color: C.muted, fontSize: 12 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: S.md },
  toggle: { width: 50, height: 30, borderRadius: R.pill, backgroundColor: C.bg3, padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: C.green },
  knob: { width: 24, height: 24, borderRadius: R.pill, backgroundColor: C.sub },
  knobOn: { backgroundColor: "#fff", alignSelf: "flex-end" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md },
  linkTxt: { color: C.text, fontSize: 14, flex: 1 },
  foot: { color: C.muted, fontSize: 11, textAlign: "center", marginTop: S.md },
});
