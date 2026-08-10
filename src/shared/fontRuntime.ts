let currentErrors: string[] = [];

export const setFontLoadErrors = (errors: string[]) => { currentErrors = errors; };
export const fontLoadErrors = () => [...currentErrors];
