import { Row, autofill, AIError } from "./ai";
import { debounce } from "lodash";
import { isExtensionIgnoreEmpty } from "./setUtils";

const DEBOUNCE_MILLISECONDS = 1000;
const MIN_ROWS_FOR_SUGGESTIONS = 1;
const SUGGESTIONS_TO_CACHE = 5;

/**
 * Helper Function
 */

// Returns whether there are enough non-empty rows to generate suggestions.
function enoughRows(rows: Row[]): boolean {
  return rows.filter(row => row !== "").length >= MIN_ROWS_FOR_SUGGESTIONS;
}

// Returns whether suggestions should be completely cleared.
function shouldClearSuggestions(rows: Row[]): boolean {
  // If there aren't enough rows to generate suggestions, clear.
  return !enoughRows(rows);
}

// Consumes AI errors but throws other errors up.
function consumeAIErrors(e: Error) {
  if (e instanceof AIError) {
    console.log('Encountered but subdued error while generating suggestions:', e);
  } else {
    throw new Error("Unexpected error: " + e);
  }
}

/**
 * Holds a cache of suggestions generated by AI.
 */
class AISuggestionsManager {

    // The values that the current suggestions are based on.
    base: Row[] = [];
    // A cache of suggestions.
    suggestions: Row[] = [];
    // Holder for the previous state of the suggestions, used to determine if the suggestions need to be refreshed.
    previousSuggestions: Row[] = [];
    // Callback to call when the suggestions change.
    onSuggestionsUpdated: (suggestions: Row[]) => void;
    // Whether the suggestions are loading.
    isLoading: boolean = false;

    constructor(
      onSuggestionsUpdated: (suggestions: Row[]) => void
      ) {
        this.onSuggestionsUpdated = onSuggestionsUpdated;
    }

    /**
     * Private Functions
     */

    // Helper to set the suggestions and previousSuggestions together and notify the callback.
    private setSuggestions(suggestions: Row[]) {
      this.previousSuggestions = this.suggestions;
      this.suggestions = suggestions;
      this.onSuggestionsUpdated(this.suggestions);
    }

    // Returns whether suggestions should be updated based on the current state and the new base.
    private shouldUpdateSuggestions(newBase: Row[]): boolean {
      // (1) If there are no more suggestions, always update.
      if (this.suggestions.length === 0) return true;
      // Otherwise, update if all of the following are true:
      // (1) Suggestions aren't already loading.
      // (2) There are enough rows to generate suggestions.
      // (3) The new base is different from the old base.
      // (4) The new base isn't an "extension" of the old base.
      if (
        !this.isLoading &&
        enoughRows(newBase) &&
        this.base !== newBase &&
        !isExtensionIgnoreEmpty(newBase, this.base, this.previousSuggestions)
      ) {
        return true;
      }
      return false;
    }

    // Clears the suggestions.
    private clearSuggestions() {
      this.setSuggestions([])
      this.onSuggestionsUpdated(this.suggestions);
    }

    // Updates the suggestions by querying the LLM.
    private updateSuggestions() {
      this.isLoading = true;
      // Query LLM.
      autofill(this.base, SUGGESTIONS_TO_CACHE)
        // Update suggestions.
        .then((suggestions) => {
          this.setSuggestions(suggestions)
          this.onSuggestionsUpdated(this.suggestions);
        })
        .catch(consumeAIErrors)
        .finally(() => {
          this.isLoading = false;
        });
    }

    /**
     * Public API
     */

    // Update what the suggestions are based off of. Debounce included.
    update: (newBase: Row[]) => void
      = debounce((newBase) => {
        // Clear suggestions if necessary.
        if (shouldClearSuggestions(newBase)) {
          this.clearSuggestions();
          return;
        }
        // Update suggestions if necessary.
        if (this.shouldUpdateSuggestions(newBase)) {
          this.base = newBase;
          this.updateSuggestions();
        }
        // If the new base is an extension of the old base, update the base to reflect the extension.
        if (isExtensionIgnoreEmpty(newBase, this.base, this.previousSuggestions)) {
          this.base = newBase;
        }
      }, DEBOUNCE_MILLISECONDS);

    // Returns the suggestions.
    peekSuggestions(): Row[] {
      return this.suggestions;
    }

    // Returns the suggestion and removes it from the list. Defaults to the first one if no index.
    popSuggestions(index?: number): Row {
      const i = index ? index : 0;
      const popped = this.suggestions[i];
      const leftHalf = this.suggestions.slice(0, i);
      const rightHalf = this.suggestions.slice(i + 1);
      this.setSuggestions(leftHalf.concat(rightHalf));
      return popped;
    }

    // Removes a suggestion from the list.
    removeSuggestion(suggestion: Row): void {
      const i = this.suggestions.indexOf(suggestion);
      this.popSuggestions(i);
    }

    // Returns whether suggestions are loading.
    areSuggestionsLoading(): boolean {
      return this.isLoading;
    }

    // Deterministically reorders the list of suggestions
    cycleSuggestions(): void {
      // Move the current suggestion to the end of the list
      const first = this.suggestions[0];
      const rest = this.suggestions.slice(1);
      this.setSuggestions(rest.concat([first]));
    }
}

export default AISuggestionsManager;