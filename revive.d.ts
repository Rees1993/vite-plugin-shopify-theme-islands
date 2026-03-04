declare function revive(islands: Record<string, () => Promise<unknown>>): void;
export default revive;
