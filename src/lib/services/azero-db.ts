// PostgreSQL client for AZero DB (external database)
// Contains employee and customer data with QuickBooks IDs

import pg from 'pg';
import { AZERO_DATABASE_URL } from '$env/static/private';

export interface Employee {
	id: number;
	name: string;
	email: string;
	qbo_id: string; // QuickBooks Online employee/vendor ID
}

export interface Customer {
	id: number;
	name: string;
	qbo_id: string; // QuickBooks Online customer ID
}

let pgPool: pg.Pool | null = null;

/**
 * Get the PostgreSQL connection pool (singleton)
 */
export function getAZeroClient(): pg.Pool {
	if (!pgPool) {
		if (!AZERO_DATABASE_URL) {
			throw new Error('Missing AZERO_DATABASE_URL environment variable');
		}

		pgPool = new pg.Pool({
			connectionString: AZERO_DATABASE_URL,
			ssl: { rejectUnauthorized: false },
			max: 10,
			idleTimeoutMillis: 30000,
		});
	}
	return pgPool;
}

/**
 * Fuzzy match employee by name
 */
export async function getEmployeeByName(name: string): Promise<Employee | null> {
	const client = getAZeroClient();
	const result = await client.query(
		`SELECT id, name, email, qbo_id
     FROM prod_employees
     WHERE LOWER(name) LIKE LOWER($1)
     LIMIT 1`,
		[`%${name}%`]
	);
	return result.rows[0] || null;
}

// Customer name aliases for common shortcuts
const CUSTOMER_ALIASES: Record<string, string> = {
	'ice': 'Infrastructure Consulting & Engineering',
	'arvaya': 'Arvaya Internal',
	'arvaya internal': 'Arvaya Internal',
};

/**
 * Fuzzy match customer by name (supports aliases like ICE → Infrastructure Consulting & Engineering)
 */
export async function getCustomerByName(name: string): Promise<Customer | null> {
	const client = getAZeroClient();

	// Check for alias first
	const lowerName = name.toLowerCase().trim();
	const resolvedName = CUSTOMER_ALIASES[lowerName] || name;

	const result = await client.query(
		`SELECT id, name, qbo_id
     FROM prod_customers
     WHERE LOWER(name) LIKE LOWER($1)
     LIMIT 1`,
		[`%${resolvedName}%`]
	);
	return result.rows[0] || null;
}

/**
 * Get all employees (for AI context)
 */
export async function getAllEmployees(): Promise<Employee[]> {
	const client = getAZeroClient();
	const result = await client.query(
		`SELECT id, name, email, qbo_id FROM prod_employees ORDER BY name`
	);
	return result.rows;
}

/**
 * Get all customers (for AI context)
 */
export async function getAllCustomers(): Promise<Customer[]> {
	const client = getAZeroClient();
	const result = await client.query(`SELECT id, name, qbo_id FROM prod_customers ORDER BY name`);
	return result.rows;
}
