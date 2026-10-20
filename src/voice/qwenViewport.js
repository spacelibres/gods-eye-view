/** Retain one stateless vision result without adding images to realtime history. */
export function createQwenViewport({ analyze, onChange }) {
  let generation = 0;
  let abort = null;
  let pending = null;
  let itemId = null;
  let context = null;
  const cancel = (notify = true) => {
    generation++;
    abort?.abort();
    abort = null;
    pending = null;
    if (notify) onChange('cancelled');
  };
  return {
    get pending() {
      return pending;
    },
    get context() {
      return context;
    },
    replace(item) {
      cancel(false);
      itemId = item.id;
      context = null;
      onChange('pending');
      abort = new AbortController();
      const signal = abort.signal;
      const epoch = generation;
      const text = item.content
        .filter((part) => part.type === 'input_text')
        .map((part) => part.text)
        .join('\n');
      pending = Promise.resolve()
        .then(() => analyze(item.content, { signal }))
        .then((description) => {
          if (epoch === generation)
            context = { available: true, context: text, description };
        })
        .catch(() => {
          if (epoch === generation)
            context = { available: false, context: text };
        })
        .finally(() => {
          if (epoch !== generation) return;
          pending = null;
          onChange('settled');
        });
    },
    remove(id) {
      if (id !== itemId) return;
      cancel(false);
      itemId = null;
      context = null;
      onChange('removed');
    },
    cancel,
    dispose() {
      cancel(false);
      itemId = null;
      context = null;
    },
  };
}
