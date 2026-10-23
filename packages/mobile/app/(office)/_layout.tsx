import { Tabs } from "expo-router";
import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { House, ClipboardText, ChatCircleDots, UsersThree, CalendarBlank } from "phosphor-react-native";
import { C } from "../../lib/theme";
import { useAccess } from "../../lib/use-access";
import { useLayout } from "../../lib/use-layout";
import { useDispatchStream } from "../../lib/use-dispatch-stream";
import { usePushNotifications, setAppBadgeCount, setPushRouting } from "../../lib/push";
import { useDispatchThreads } from "../../lib/use-threads";
import { endAllLiveActivities } from "../../lib/useLiveActivity";
import { UndoToastHost } from "../../components/office/undo-toast";

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
  const { wide } = useLayout();
  useDispatchStream(true);
  usePushNotifications();

  // A dual-role owner who just switched from field mode may still have a
  // Live Activity on the Lock Screen; office mode has no job in progress.
  useEffect(() => {
    endAllLiveActivities().catch(() => {});
    setPushRouting("office");
    return () => setPushRouting("field");
  }, []);

  const seesJobs = isLoading || can("work_orders:view") || can("scheduler:view");
  // The timeline board needs the room an iPad has; a phone keeps Jobs.
  const seesBoard = wide && (isLoading || can("work_orders:view") || can("scheduler:view"));
  const seesTeam = isLoading || can("techs:view");
  // /api/messages/* needs work_orders:view (api/lib/office-access.ts), so a
  // scheduler-only member gets no Messages tab rather than a tab of 403s.
  const seesMessages = !isLoading && can("work_orders:view");

  // Unread from technicians, across every thread. The rider summary endpoint
  // counts the other direction, so office mode reads the dispatcher inbox.
  const { unread: msgBadge } = useDispatchThreads(seesMessages);
  useEffect(() => {
    setAppBadgeCount(seesMessages ? msgBadge : 0);
  }, [msgBadge, seesMessages]);

  return (
    <>
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
          name="board"
          options={{
            title: "Board",
            href: seesBoard ? undefined : null,
            tabBarIcon: ({ color, focused }) => <CalendarBlank color={color} size={24} weight={focused ? "fill" : "regular"} />,
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: "Messages",
            href: seesMessages ? undefined : null,
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
      <UndoToastHost />
    </>
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
