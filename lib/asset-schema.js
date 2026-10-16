// Additive migrations retain existing assets and never invent purchase or supplier data.
export const assetColumns = [
 ['purchase_date', "TEXT DEFAULT ''"], ['purchase_cost','DOUBLE PRECISION'],
 ['vendor_id', 'TEXT REFERENCES vendors(id)'], ['maintenance_interval_days','BIGINT'],
 ['last_maintenance', "TEXT DEFAULT ''"], ['next_maintenance', "TEXT DEFAULT ''"]
];
export const vendorSchema = `CREATE TABLE IF NOT EXISTS vendors(id TEXT PRIMARY KEY,name TEXT NOT NULL,registration TEXT NOT NULL UNIQUE,phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Active');`;
export function migrateAssetsSqlite(db) {
 db.exec(vendorSchema);
 const columns = new Set(db.prepare('PRAGMA table_info(equipment)').all().map(c=>c.name));
 for(const [column,type] of assetColumns) if(!columns.has(column)) db.exec('ALTER TABLE equipment ADD COLUMN '+column+' '+type);
}
export async function migrateAssetsPostgres(client) {
 await client.query(vendorSchema);
 for(const [column,type] of assetColumns) await client.query('ALTER TABLE equipment ADD COLUMN IF NOT EXISTS '+column+' '+type);
}
