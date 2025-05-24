export function serializeData(data: any) {
    return JSON.stringify(data, (_key, value) => {
      if (value instanceof Set) {
        return { __type: 'Set', value: Array.from(value) };
      }
      if (value instanceof Map) {
        return { __type: 'Map', value: Array.from(value.entries()) };
      }
      return value;
    });
  }
  
  export function deserializeData(jsonString: string) {
    return JSON.parse(jsonString, (_key, value) => {
      if (value && value.__type === 'Set') {
        return new Set(value.value);
      }
      if (value && value.__type === 'Map') {
        return new Map(value.value);
      }
      return value;
    });
  }