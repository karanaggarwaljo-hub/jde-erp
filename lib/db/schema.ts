export type TableSchema = {
  primaryKey: string;
  /** When true, rows belong to a company (company_id column) and reads/writes are scoped to the active company. */
  companyScoped?: boolean;
};

export const TABLES: Record<string, TableSchema> = {
  companies: { primaryKey: 'id' },
  products: { primaryKey: 'id', companyScoped: true },
  customers: { primaryKey: 'id', companyScoped: true },
  suppliers: { primaryKey: 'id', companyScoped: true },
  invoices: { primaryKey: 'id', companyScoped: true },
  quotations: { primaryKey: 'id', companyScoped: true },
  purchase_orders: { primaryKey: 'id', companyScoped: true },
  grns: { primaryKey: 'id', companyScoped: true },
  expenses: { primaryKey: 'id', companyScoped: true },
  users: { primaryKey: 'email', companyScoped: true },
};

export type TableName = keyof typeof TABLES;
