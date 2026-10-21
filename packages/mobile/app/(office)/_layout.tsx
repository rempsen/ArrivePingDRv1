import { Tabs } from "expo-router";
import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { House, ClipboardText, ChatCircleDots, UsersThree } from "phosphor-react-native";
import { C } from "../../lib/theme";
import { useAccess } from "../../lib/use-access";
import { useDispatchStream } from "../../lib/use-dispatch-stream";
import { usePushNotifications, setAppBadgeCount } from "../../lib/push";
import { useDispatchThreads } from "../../lib/use-threads";
import { endAllLiveActivities } from "../../lib/useLiveActivity";

/**
 * Office mode: the dispatcher's, manager's and owner's side of the app.
 *
 * Deliberately NOT mounted here, unlike the rider layout: the location
 * heartbeat (an office phone must never report itself as a technician's
 * position), the shift reconciliation against `/riders/me` (which would
 * create a rider record for this person), and the technician coach tour.
 *
 * Tabs hide when the person's role can't see the data behind them; the
 * server enforces the same permissions on every call regardless.
 */
export default function OfficeLayout() {
  const { can, isLoading } = useAccess();
  useDispatchStream(true);
  usePushNotifications();

  // A dual-role owner who just switched from field mode may still have a
  // Live Activity on the Lock Screen; office mode has no job in progress.
  useEffect(() => {
    endAllLiveActivities().catch(() => {});
  }, []);

  // Unread from technicians, across every thread. The rider summary endpoint
  // counts the other direction, so office mode reads the dispatcher inbox.
  const { unread: msgBadge } = useDispatchThreads();
  useEffect(() => {
    setAppBadgeCount(msgBadge);
  }, [msgBadge]);

  const seesJobs = isLoading || can("work_orders:view") || can("scheduler:view");
  const seesTeam = isLoading || can("techs:view");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.brand,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.bg2,
          borderTopColor: C.border,
          borderTopWidth: 1,
          height: 84,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color, focused }) => <House color={color} size={24} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: "Jobs",
          href: seesJobs ? undefined : null,
          tabBarIcon: ({ color, focused }) => <ClipboardText color={color} size={24} weight={focused ? "fill" : "regular"} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon count={msgBadge} label={msgBadge === 1 ? "1 unread message" : `${msgBadge} unread messages`}>
              <ChatCircleDots color={color} size={24} weight={focused ? "fill" : "regular"} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: "Team",
          href: seesTeam ? undefined : null,
          tabBarIcon: ({ color, focused }) => <UsersThree color={color} size={24} weight={focused ? "fill" : "regular"} />,
        }}
      />
    </Tabs>
  );
}

function TabIcon({ count, label, children }: { count: number; label: string; children: React.ReactNode }) {
  if (count <= 0) return <>{children}</>;
  return (
    <View accessible accessibilityLabel={label}>
      {children}
      <View style={s.badge}>
        <Text style={s.badgeTxt} allowFontScaling={false}>
          {count > 9 ? "9+" : count}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -5,
    right: -9,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.red,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: C.bg2,
  },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
