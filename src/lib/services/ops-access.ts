/**
 * Ops dashboard access control.
 * Shared between the route guard and sidebar.
 */

export const OPS_ALLOWED_EMAILS = [
	'zakiquereshy@arvayaconsulting.com',
	'davidhogg@arvayaconsulting.com',
];

export function isOpsAllowed(email: string | null | undefined): boolean {
	if (!email) return false;
	return OPS_ALLOWED_EMAILS.includes(email.toLowerCase());
}
