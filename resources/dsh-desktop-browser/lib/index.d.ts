export declare const name = "desktop-browser";
export declare const inject: string[];
export declare const BROWSER_SKILL: string;
export declare function createBrowserTools(controlUrl: string, controlToken: string): any[];
export declare function apply(ctx: any, overrides?: { controlUrl?: string; controlToken?: string }): Promise<() => void>;
