/**
 * The slice of QuickBooks Online Accounting API v3 that QuickBooks Sync uses.
 * Field names are Intuit's. Everything optional unless the sync relies on it.
 */

export interface Ref {
  value: string;
  name?: string;
}

export interface MetaData {
  CreateTime?: string;
  LastUpdatedTime?: string;
}

export interface Vendor {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  Active?: boolean;
  PrimaryEmailAddr?: { Address: string };
  MetaData?: MetaData;
}

export interface Customer {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  FullyQualifiedName?: string;
  Active?: boolean;
  Job?: boolean;
  ParentRef?: Ref;
  MetaData?: MetaData;
}

export interface Item {
  Id: string;
  SyncToken: string;
  Name: string;
  FullyQualifiedName?: string;
  Type: "Service" | "Inventory" | "NonInventory" | "Category" | string;
  Active?: boolean;
}

export interface TaxCode {
  Id: string;
  Name: string;
  Active?: boolean;
  Taxable?: boolean;
  TaxGroup?: boolean;
  PurchaseTaxRateList?: { TaxRateDetail?: { TaxRateRef: Ref; TaxTypeApplicable?: string }[] };
}

export interface LinkedTxn {
  TxnId: string;
  TxnType: "PurchaseOrder" | "Bill" | "BillPayment" | string;
  TxnLineId?: string;
}

export interface ItemBasedExpenseLine {
  Id?: string;
  LineNum?: number;
  Description?: string;
  Amount: number;
  DetailType: "ItemBasedExpenseLineDetail";
  LinkedTxn?: LinkedTxn[];
  ItemBasedExpenseLineDetail: {
    ItemRef: Ref;
    CustomerRef?: Ref;
    TaxCodeRef?: Ref;
    Qty?: number;
    UnitPrice?: number;
    BillableStatus?: "Billable" | "NotBillable" | "HasBeenBilled";
  };
}

export interface PurchaseOrder {
  Id?: string;
  SyncToken?: string;
  DocNumber?: string;
  TxnDate?: string;
  PrivateNote?: string;
  POStatus?: "Open" | "Closed";
  TotalAmt?: number;
  VendorRef: Ref;
  APAccountRef?: Ref;
  Line: ItemBasedExpenseLine[];
  LinkedTxn?: LinkedTxn[];
  GlobalTaxCalculation?: "TaxExcluded" | "TaxInclusive" | "NotApplicable";
  MetaData?: MetaData;
}

export interface Bill {
  Id?: string;
  SyncToken?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  PrivateNote?: string;
  TotalAmt?: number;
  Balance?: number;
  VendorRef: Ref;
  APAccountRef?: Ref;
  Line: ItemBasedExpenseLine[];
  LinkedTxn?: LinkedTxn[];
  GlobalTaxCalculation?: "TaxExcluded" | "TaxInclusive" | "NotApplicable";
  MetaData?: MetaData;
}

export interface BillPayment {
  Id: string;
  SyncToken: string;
  TxnDate?: string;
  TotalAmt?: number;
  VendorRef?: Ref;
  Line?: { Amount: number; LinkedTxn: LinkedTxn[] }[];
  MetaData?: MetaData;
}

export interface CompanyInfo {
  Id: string;
  CompanyName: string;
  Country?: string;
  NameValue?: { Name: string; Value: string }[];
}

/** Response envelope of GET /query. */
export interface QueryResponse<T> {
  QueryResponse: Partial<Record<string, T[]>> & { startPosition?: number; maxResults?: number; totalCount?: number };
  time?: string;
}

/** Response envelope of /cdc. */
export interface CdcResponse {
  CDCResponse: { QueryResponse: (Partial<Record<string, unknown[]>> & { startPosition?: number; maxResults?: number })[] }[];
  time?: string;
}

/** One webhook POST from Intuit. */
export interface WebhookPayload {
  eventNotifications: {
    realmId: string;
    dataChangeEvent: {
      entities: {
        name: string;
        id: string;
        operation: "Create" | "Update" | "Delete" | "Merge" | "Void" | "Emailed" | string;
        lastUpdated: string;
        deletedId?: string;
      }[];
    };
  }[];
}
