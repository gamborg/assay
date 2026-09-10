/**
 * Trace recording.
 *
 * Every observable thing an agent run does becomes an event with a monotonic
 * timestamp. Assertions read the trace rather than the final answer, because
 * "did it call the right tool" is not visible in the text output.
 *
 * The trace is the contract between the runner, the gates and the reports.
 * Keep it boring and serialisable.
 */

class Trace {
  #events = [];
  #clock;
  #startedAt;

  /**
   * @param {{clock?: () => number}} options injectable clock keeps tests deterministic
   */
  constructor({ clock = () => performance.now() } = {}) {
    this.#clock = clock;
    this.#startedAt = clock();
  }

  /**
   * @param {string} type e.g. "model_request", "tool_call"
   * @param {object} data anything JSON-serialisable
   */
  record(type, data = {}) {
    const event = {
      type,
      atMs: Math.round(this.#clock() - this.#startedAt),
      ...data,
    };
    this.#events.push(event);
    return event;
  }

  get events() {
    return [...this.#events];
  }

  /** @param {string} type */
  eventsOfType(type) {
    return this.#events.filter((event) => event.type === type);
  }

  get durationMs() {
    return Math.round(this.#clock() - this.#startedAt);
  }

  toJSON() {
    return this.events;
  }
}

export { Trace };
