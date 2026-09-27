export const greet = (name: string): string => "Hello " + name
export const aged = (age: number): string => age + " years"
export const quoted = (name: string): string => "`" + name
export const described = (name: string, age: number): string => name + " is " + age
export const sum = (a: number, b: number): number => a + b
export const listed = (items: ReadonlyArray<string>): string => "Items: " + items
