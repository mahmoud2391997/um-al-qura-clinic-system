// Additive, dialect-neutral tables. New entities use caller-generated UUIDs.
export const readinessSchema=`
CREATE TABLE IF NOT EXISTS invoice_report_facts(invoice_id BIGINT PRIMARY KEY REFERENCES invoices(id),issued_day TEXT NOT NULL,service TEXT NOT NULL,department TEXT);
CREATE TABLE IF NOT EXISTS session_report_facts(clinical_id BIGINT PRIMARY KEY REFERENCES clinical(id),approved_day TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patient_tasks(patient_id BIGINT NOT NULL REFERENCES patients(id),task_id BIGINT NOT NULL REFERENCES tasks(id),PRIMARY KEY(patient_id,task_id));
CREATE TABLE IF NOT EXISTS service_catalog(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,department TEXT NOT NULL,active BIGINT NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS service_booking_policy(service_id TEXT PRIMARY KEY REFERENCES service_catalog(id),duration_minutes BIGINT NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440));
CREATE TABLE IF NOT EXISTS booking_requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,patient_id BIGINT NOT NULL REFERENCES patients(id),appointment_id BIGINT NOT NULL REFERENCES appointments(id));
CREATE TABLE IF NOT EXISTS service_prices(id TEXT PRIMARY KEY,service_id TEXT NOT NULL REFERENCES service_catalog(id),effective_date TEXT NOT NULL,amount DOUBLE PRECISION NOT NULL,floor DOUBLE PRECISION NOT NULL,actor TEXT NOT NULL REFERENCES users(id),UNIQUE(service_id,effective_date));
CREATE TABLE IF NOT EXISTS record_prices(kind TEXT NOT NULL,record_id BIGINT NOT NULL,price_id TEXT NOT NULL REFERENCES service_prices(id),service_name TEXT NOT NULL,amount DOUBLE PRECISION NOT NULL,floor DOUBLE PRECISION NOT NULL,PRIMARY KEY(kind,record_id));
CREATE TABLE IF NOT EXISTS below_cost_requests(id TEXT PRIMARY KEY,patient_id BIGINT NOT NULL REFERENCES patients(id),price_id TEXT NOT NULL REFERENCES service_prices(id),amount DOUBLE PRECISION NOT NULL,reason TEXT NOT NULL,creator TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'Pending',reviewer TEXT,decision TEXT,invoice_id BIGINT,idempotency_key TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS stock_adjustment_policy(id BIGINT PRIMARY KEY,quantity_limit DOUBLE PRECISION NOT NULL,value_limit DOUBLE PRECISION NOT NULL);
CREATE TABLE IF NOT EXISTS stock_adjustment_requests(id TEXT PRIMARY KEY,item_id BIGINT NOT NULL REFERENCES inventory(id),previous DOUBLE PRECISION NOT NULL,quantity DOUBLE PRECISION NOT NULL,cost DOUBLE PRECISION NOT NULL,reason TEXT NOT NULL,creator TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'Pending',reviewer TEXT,decision TEXT,movement_id BIGINT,idempotency_key TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS maintenance_parts(id TEXT PRIMARY KEY,ticket_id BIGINT NOT NULL REFERENCES maintenance(id),movement_id BIGINT NOT NULL REFERENCES stock_movements(id),creator TEXT NOT NULL REFERENCES users(id),idempotency_key TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS lead_visits(lead_id BIGINT PRIMARY KEY REFERENCES leads(id),patient_id BIGINT NOT NULL REFERENCES patients(id),appointment_id BIGINT UNIQUE NOT NULL REFERENCES appointments(id),stage TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lead_transitions(id TEXT PRIMARY KEY,lead_id BIGINT NOT NULL REFERENCES leads(id),stage TEXT NOT NULL,actor TEXT NOT NULL,time TEXT NOT NULL);
`;
