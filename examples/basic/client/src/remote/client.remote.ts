export const clientFunctions = {
  confirm: async (message: string): Promise<boolean> => {
    return window.confirm(message);
  },

  alert: async (message: string): Promise<void> => {
    window.alert(message);
  }
};