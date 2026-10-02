import type { ComponentType } from "react";
import type { SceneName } from "../media";
import { HeroDispatchArrival } from "./HeroDispatchArrival";
import { DispatchAssign } from "./DispatchAssign";
import { RouteAndCustomerETA } from "./RouteAndCustomerETA";
import { UpdateToCustomer } from "./UpdateToCustomer";
import { ClosingStatus, CustomerCardUpdate, ListStatusSettle } from "./SmallScenes";

export const scenes: Record<SceneName, ComponentType> = {
  HeroDispatchArrival,
  DispatchAssign,
  RouteAndCustomerETA,
  UpdateToCustomer,
  ListStatusSettle,
  CustomerCardUpdate,
  ClosingStatus,
};
