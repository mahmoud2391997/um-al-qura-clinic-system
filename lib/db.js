import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {defaultRoles} from './permissions.js';

export function createDatabase(filename){
if(filename!==':memory:')mkdirSync(filename.slice(0,filename.lastIndexOf('/'))||'.',{recursive:true});
const db=new DatabaseSync(filename);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY,name TEXT NOT NULL,permissions TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT REFERENCES roles(id),active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,entity TEXT,before_value TEXT,after_value TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS patients(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL,source TEXT,birth TEXT,gender TEXT,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY,patient_id INTEGER REFERENCES patients(id),provider TEXT,start TEXT,end TEXT,room TEXT,service TEXT,status TEXT DEFAULT 'Pending',reason TEXT,arrived TEXT,started TEXT,completed TEXT);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,title TEXT,owner TEXT,due TEXT,priority TEXT,status TEXT DEFAULT 'Open',evidence TEXT);
CREATE TABLE IF NOT EXISTS clinical(id INTEGER PRIMARY KEY,patient_id INTEGER REFERENCES patients(id),provider TEXT,kind TEXT,episode TEXT,content TEXT,approved INTEGER DEFAULT 0,parent_id INTEGER REFERENCES clinical(id));
CREATE TABLE IF NOT EXISTS equipment(id INTEGER PRIMARY KEY,name TEXT NOT NULL,model TEXT,serial TEXT,location TEXT,status TEXT DEFAULT 'Active',warranty TEXT,component TEXT,capacity INTEGER DEFAULT 0,used INTEGER DEFAULT 0,replacement_cost REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS equipment_usage(id INTEGER PRIMARY KEY,equipment_id INTEGER REFERENCES equipment(id),quantity INTEGER,reference TEXT,actor TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS maintenance(id INTEGER PRIMARY KEY,equipment_id INTEGER REFERENCES equipment(id),kind TEXT,description TEXT,priority TEXT,owner TEXT,due TEXT,cost REAL DEFAULT 0,status TEXT DEFAULT 'Open',closed TEXT);
CREATE TABLE IF NOT EXISTS inventory(id INTEGER PRIMARY KEY,name TEXT,sku TEXT UNIQUE,unit TEXT,supplier TEXT,location TEXT,minimum REAL DEFAULT 0,expiry TEXT,quantity REAL DEFAULT 0,average_cost REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stock_movements(id INTEGER PRIMARY KEY,item_id INTEGER REFERENCES inventory(id),kind TEXT,quantity REAL,cost REAL,reference TEXT,reason TEXT,actor TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS stock_batches(id INTEGER PRIMARY KEY,item_id INTEGER REFERENCES inventory(id),number TEXT NOT NULL,expiry TEXT DEFAULT '',quantity REAL NOT NULL CHECK(quantity>=0),cost REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS stock_allocations(id INTEGER PRIMARY KEY,movement_id INTEGER REFERENCES stock_movements(id),batch_id INTEGER REFERENCES stock_batches(id),quantity REAL);
CREATE TABLE IF NOT EXISTS purchase_requests(id INTEGER PRIMARY KEY,title TEXT,department TEXT,needed TEXT,priority TEXT,reason TEXT,supplier TEXT,cost_center TEXT,creator TEXT REFERENCES users(id),status TEXT DEFAULT 'Draft',items TEXT,total REAL,reviewer TEXT,decision_reason TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_orders(id INTEGER PRIMARY KEY,request_id INTEGER UNIQUE REFERENCES purchase_requests(id),creator TEXT REFERENCES users(id),status TEXT DEFAULT 'Open',created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchase_receipts(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES purchase_orders(id),item_id INTEGER REFERENCES inventory(id),quantity REAL,batch_number TEXT,batch_expiry TEXT,reference TEXT,actor TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP,idempotency_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,title TEXT,category TEXT,supplier TEXT,amount REAL,date TEXT,method TEXT,cost_center TEXT,reference TEXT);
CREATE TABLE IF NOT EXISTS obligations(id INTEGER PRIMARY KEY,title TEXT,amount REAL,owner TEXT,due TEXT,recurrence TEXT,reference TEXT,status TEXT DEFAULT 'Due');
CREATE TABLE IF NOT EXISTS licenses(id INTEGER PRIMARY KEY,title TEXT,entity TEXT,issuer TEXT,issued TEXT,expiry TEXT,owner TEXT,reference TEXT,status TEXT DEFAULT 'Valid');
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,invoice_id INTEGER REFERENCES invoices(id),kind TEXT,amount REAL,method TEXT,reason TEXT,actor TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS discounts(id INTEGER PRIMARY KEY,invoice_id INTEGER REFERENCES invoices(id),amount REAL,reason TEXT,actor TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS finance_policy(id INTEGER PRIMARY KEY CHECK(id=1),discount_limit REAL NOT NULL,refund_limit REAL NOT NULL);
INSERT OR IGNORE INTO finance_policy VALUES(1,0,0);
CREATE TABLE IF NOT EXISTS cash_closures(id INTEGER PRIMARY KEY,date TEXT UNIQUE NOT NULL,opening REAL,collections REAL,refunds REAL,expenses REAL,expected REAL,counted REAL,difference REAL,reason TEXT,actor TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS episodes(id INTEGER PRIMARY KEY,patient_id INTEGER REFERENCES patients(id),provider TEXT REFERENCES users(id),title TEXT,status TEXT DEFAULT 'Active',UNIQUE(patient_id,provider,title));
CREATE TABLE IF NOT EXISTS clinical_details(clinical_id INTEGER PRIMARY KEY REFERENCES clinical(id),episode_id INTEGER REFERENCES episodes(id),structured TEXT);
CREATE TABLE IF NOT EXISTS packages(id INTEGER PRIMARY KEY,patient_id INTEGER REFERENCES patients(id),service TEXT,total INTEGER,expiry TEXT);
CREATE TABLE IF NOT EXISTS appointment_packages(appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id),package_id INTEGER REFERENCES packages(id));
CREATE TABLE IF NOT EXISTS package_usage(id INTEGER PRIMARY KEY,package_id INTEGER REFERENCES packages(id),appointment_id INTEGER UNIQUE REFERENCES appointments(id),time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS integration_jobs(id INTEGER PRIMARY KEY,kind TEXT,reference TEXT,payload TEXT,idempotency_key TEXT UNIQUE,status TEXT,time TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS costing(id INTEGER PRIMARY KEY,service TEXT,price REAL,staff REAL,consumables REAL,device REAL,overhead REAL);
CREATE TABLE IF NOT EXISTS campaigns(id INTEGER PRIMARY KEY,name TEXT,channel TEXT,budget REAL,start TEXT,end TEXT);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,campaign_id INTEGER REFERENCES campaigns(id),status TEXT,owner TEXT,followup TEXT);
CREATE TABLE IF NOT EXISTS complaints(id INTEGER PRIMARY KEY,title TEXT,category TEXT,description TEXT,owner TEXT,due TEXT,status TEXT,resolution TEXT);
CREATE TABLE IF NOT EXISTS satisfaction(id INTEGER PRIMARY KEY,reference TEXT,score INTEGER,comment TEXT,date TEXT);
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY,patient_id INTEGER REFERENCES patients(id),service TEXT,amount REAL,paid REAL DEFAULT 0);
`);
for(const [id,name,p] of defaultRoles) db.prepare('INSERT OR IGNORE INTO roles VALUES(?,?,?)').run(id,name,JSON.stringify(p));
if(!db.prepare("SELECT name FROM schema_migrations WHERE name='purchasing-permissions'").get()){
 for(const [id,,permissions] of defaultRoles){const additions=permissions.filter(p=>p.startsWith('purchasing.'));if(additions.length){const role=db.prepare('SELECT permissions FROM roles WHERE id=?').get(id);db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify([...new Set([...JSON.parse(role.permissions),...additions])]),id);}}
 db.prepare('INSERT INTO schema_migrations VALUES(?)').run('purchasing-permissions');
}
return db;
}
export const db=createDatabase(process.env.CLINIC_DEMO_ONLY==='1'?':memory:':process.env.CLINIC_DB || 'data/clinic.sqlite');
export function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verifyPassword(password,hash){const [salt,value]=hash.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(value,'hex'));}
export function audit(actor,action,entity,before,after,database=db){database.prepare('INSERT INTO audit(actor,action,entity,before_value,after_value) VALUES(?,?,?,?,?)').run(actor,action,entity,JSON.stringify(before??null),JSON.stringify(after??null));}
