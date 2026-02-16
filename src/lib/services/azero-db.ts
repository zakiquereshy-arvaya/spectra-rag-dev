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
	parent_id?: number; // Parent customer ID if this is a sub-customer
	parent_qbo_id?: string; // Parent customer QBO ID if this is a sub-customer
}

let pgPool: pg.Pool | null = null;

// Employee aliases for known naming variations in prod_employees.
const EMPLOYEE_ALIASES: Record<string, string> = {
	'todd fernley': 'Todd M. Fernley',
	'todd fernly': 'Todd M. Fernley',
	'todd m fernley': 'Todd M. Fernley',
	'ashlee jack': 'Ashlee E. Jack',
};

const PLACEHOLDER_NAME_PATTERNS = [
	/^unknown\b/i,
	/^placeholder\b/i,
	/^test\b/i,
	/^employee\b/i,
	/^user\b/i,
	/^n\/?a$/i,
];

function normalizeNameForMatch(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function isPlaceholderName(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return true;
	return PLACEHOLDER_NAME_PATTERNS.some((pattern) => pattern.test(trimmed));
}

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
 * Handles cases where database has suffixes like "(1)" for duplicates
 */
export async function getEmployeeByName(name: string): Promise<Employee | null> {
	if (isPlaceholderName(name)) {
		console.warn(`[AZero DB] Rejected placeholder employee lookup input: "${name}"`);
		return null;
	}

	const client = getAZeroClient();
	const trimmedName = name.trim();
	const aliasedName = EMPLOYEE_ALIASES[trimmedName.toLowerCase()] || trimmedName;

	// First try exact match
	let result = await client.query(
		`SELECT id, name, email, qbo_id
		 FROM prod_employees
		 WHERE LOWER(name) = LOWER($1)
		 LIMIT 1`,
		[aliasedName]
	);

	if (result.rows[0]) {
		return result.rows[0];
	}

	// Try matching where DB name starts with the search name (handles "Name (1)" cases)
	result = await client.query(
		`SELECT id, name, email, qbo_id
		 FROM prod_employees
		 WHERE LOWER(name) LIKE LOWER($1)
		 ORDER BY
		   CASE WHEN LOWER(name) = LOWER($2) THEN 0 ELSE 1 END,
		   LENGTH(name)
		 LIMIT 1`,
		[`${aliasedName}%`, aliasedName]
	);

	if (result.rows[0]) {
		return result.rows[0];
	}

	// Fall back to contains match
	result = await client.query(
		`SELECT id, name, email, qbo_id
		 FROM prod_employees
		 WHERE LOWER(name) LIKE LOWER($1)
		 LIMIT 1`,
		[`%${aliasedName}%`]
	);

	if (result.rows[0]) {
		return result.rows[0];
	}

	// Final fallback: token-normalized match to handle minor punctuation/format drift.
	const normalizedInput = normalizeNameForMatch(aliasedName);
	if (!normalizedInput) return null;
	const allEmployeesResult = await client.query(
		`SELECT id, name, email, qbo_id FROM prod_employees ORDER BY name`
	);
	const match = allEmployeesResult.rows.find((row: Employee) => {
		const normalizedRowName = normalizeNameForMatch(row.name);
		return (
			normalizedRowName === normalizedInput ||
			normalizedRowName.includes(normalizedInput) ||
			normalizedInput.includes(normalizedRowName)
		);
	});

	return match || null;
}

// Customer name aliases for common shortcuts
const CUSTOMER_ALIASES: Record<string, string> = {
	'ice': 'Infrastructure Consulting & Engineering',
	'arvaya': 'Arvaya Internal',
	'arvaya internal': 'Arvaya Internal',
};

// Parent customer mappings - sub-customers that should use parent's QBO ID
// Key: child customer name (case-insensitive), Value: parent customer name
const PARENT_CUSTOMER_MAP: Record<string, string> = {
	'arvaya internal': 'Arvaya Administrative',
	'arvaya internal projects': 'Arvaya Administrative',
};

/**
 * Fuzzy match customer by name (supports aliases like ICE → Infrastructure Consulting & Engineering)
 * Returns parent customer information if the customer has a parent relationship
 */
export async function getCustomerByName(name: string): Promise<Customer | null> {
	const client = getAZeroClient();

	// Check for alias first
	//lower to force id 
	const lowerName = name.toLowerCase().trim();
	const resolvedName = CUSTOMER_ALIASES[lowerName] || name;

	// Try to get customer with parent relationship info
	// Check if parent_id column exists, if not fall back to simple query
	let result;
	try {
		result = await client.query(
			`SELECT 
				c.id, 
				c.name, 
				c.qbo_id,
				c.parent_id,
				p.qbo_id as parent_qbo_id
			FROM prod_customers c
			LEFT JOIN prod_customers p ON c.parent_id = p.id
			WHERE LOWER(c.name) LIKE LOWER($1)
			LIMIT 1`,
			[`%${resolvedName}%`]
		);
	} catch (error: any) {
		// If parent_id column doesn't exist, fall back to simple query
		if (error.message?.includes('column') && error.message?.includes('parent_id')) {
			result = await client.query(
				`SELECT id, name, qbo_id
				FROM prod_customers
				WHERE LOWER(name) LIKE LOWER($1)
				LIMIT 1`,
				[`%${resolvedName}%`]
			);
		} else {
			throw error;
		}
	}

	const customer = result.rows[0] || null;
	
	if (!customer) {
		return null;
	}
	
	// Check if this customer has a parent relationship (from database)
	if (customer.parent_qbo_id) {
		return {
			...customer,
			qbo_id: customer.parent_qbo_id, // Use parent's QBO ID for n8n workflow
		};
	}
	
	// Check hardcoded parent mappings (for known parent-child relationships)
	const customerNameLower = customer.name.toLowerCase();
	if (PARENT_CUSTOMER_MAP[customerNameLower]) {
		const parentName = PARENT_CUSTOMER_MAP[customerNameLower];
		const parentResult = await client.query(
			`SELECT id, name, qbo_id
			FROM prod_customers
			WHERE LOWER(name) = LOWER($1)
			LIMIT 1`,
			[parentName]
		);
		
		if (parentResult.rows[0]) {
			const parent = parentResult.rows[0];
			console.log(`[AZero DB] Mapping child customer "${customer.name}" (qbo_id: ${customer.qbo_id}) to parent "${parent.name}" (qbo_id: ${parent.qbo_id})`);
			return {
				...customer,
				qbo_id: parent.qbo_id, // Use parent's QBO ID for n8n workflow
				parent_id: parent.id,
				parent_qbo_id: parent.qbo_id,
			};
		}
	}
	
	return customer;
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
