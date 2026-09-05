export const replacer = (_key: string, value: any) => (typeof value === "bigint" ? value.toString() : value);
