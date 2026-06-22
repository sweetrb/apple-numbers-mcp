export interface PythonResult<T = unknown> {
    data?: T;
    error?: string;
}
/** Reset cached interpreter + bootstrap state (useful for testing). */
export declare function _resetPythonCache(): void;
export declare function runNumbersReader<T = unknown>(command: string, args: string[], timeoutMs?: number): PythonResult<T>;
export declare function checkDependencies(): {
    ok: boolean;
    message: string;
};
//# sourceMappingURL=python.d.ts.map