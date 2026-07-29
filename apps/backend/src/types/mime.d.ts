declare module "mime" {
	function getType(pathOrExtension: string): string | null;
	function getExtension(mimeType: string): string | null;
	function define(typeMap: Record<string, string[]>, force?: boolean): void;
}
