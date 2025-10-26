# Scene JSON Guide

Store all playable scenes inside the `scenes/` directory at the root of the project. Each file should follow the naming pattern `[page]-[scene].json` (for example, `7-1.json` or `5-3.json`). The application automatically imports every JSON file in that folder, sorts them alphabetically by filename, and uses the filename (without the extension) for the scene selector.

## File Structure

Each scene file should match the structure shown below. A reusable starter is available in [`scene-template.json`](./scene-template.json).

```json
{
  "narrative": {
    "title": "Scene Title",
    "paragraphs": [
      "Narrative paragraph one.",
      "Additional narrative paragraph text."
    ],
    "vocabulary": [
      {
        "word": "target word",
        "definition": "student-friendly definition.",
        "examples": [
          "Example sentence one using the target word.",
          "Example sentence two using the target word."
        ]
      }
    ]
  },
  "timeline": {
    "events": [
      { "type": "anchor", "text": "Anchor event description." },
      { "type": "blank", "text": "Blank event description." }
    ],
    "distractors": [
      "Distractor event text."
    ]
  }
}
```

### Narrative Section
- `title`: Heading displayed above the narrative content.
- `paragraphs`: Ordered array of narrative paragraphs. Target vocabulary words inside the text will be automatically highlighted if they match a `vocabulary.word` entry.
- `vocabulary`: Array of vocabulary entries that power the tap-to-open modal.
  - `word`: The vocabulary word to highlight in the narrative text.
  - `definition`: Student-friendly definition rendered alongside the word.
  - `examples`: Exactly two example sentences are recommended to align with the modal layout.

### Timeline Section
- `events`: Ordered list of objects. Use `type: "anchor"` for locked-in reference events and `type: "blank"` for interactive tiles.
- `distractors`: Additional incorrect options that appear in the selection modal. The app combines the blank event texts with these distractors and shuffles them once per scene load.

### Tips
- Keep vocabulary words lowercase in the JSON to ensure consistent highlighting.
- Anchor events should appear in the sequence exactly where they belong. Blank events will display in timeline order but require player input.
- When a new scene file is added, reload the webpage to see it appear in the selector automatically.
