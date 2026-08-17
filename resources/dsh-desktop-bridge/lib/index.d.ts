export declare const name = "desktop-bridge";
export declare const inject: string[];
export declare const RESTART_TOOL_NAME = "desktop_restart_harness";
export declare const STATIC_GUIDANCE: string;
export interface RestartToolExecution {
    concludeTurn(): void;
}
export interface RestartTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: Record<string, unknown>;
    execute(args: {
        reason?: string;
    }, execution: RestartToolExecution): Promise<string>;
}
export declare function createRestartTool(controlUrl: string, controlToken: string, fetchImpl?: typeof fetch): RestartTool;
export declare function apply(ctx: any, overrides?: {
    controlUrl?: string;
    controlToken?: string;
    profilePath?: string;
}): Promise<() => void>;
