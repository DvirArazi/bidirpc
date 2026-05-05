export const serverFunctions = {
  add: async (a: number, b: number): Promise<number> => {
    return a + b;
  },

  getServerTime: async (): Promise<string> => {
    return new Date().toISOString();
  }
};