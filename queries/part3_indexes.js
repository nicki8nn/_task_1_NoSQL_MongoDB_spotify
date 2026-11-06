

db = db.getSiblingDB("spotify");


// Walk the plan tree and collect the stage names, e.g.
// "FETCH <- IXSCAN (genre_popularity_danceability)"
function planStages(node, out) {
  out = out || [];
  if (!node) return out;
  out.push(node.stage + (node.indexName ? " (" + node.indexName + ")" : ""));
  if (node.inputStage) planStages(node.inputStage, out);
  if (node.inputStages) node.inputStages.forEach(n => planStages(n, out));
  return out;
}

function showExplain(label, explainResult) {
  const wp = explainResult.queryPlanner.winningPlan;
  const plan = wp.queryPlan || wp; // newer MongoDB versions wrap the plan in "queryPlan"
  const s = explainResult.executionStats;
  print("\n--- " + label + " ---");
  print("Plan stages:         " + planStages(plan).join(" <- "));
  print("nReturned:           " + s.nReturned);
  print("totalKeysExamined:   " + s.totalKeysExamined);
  print("totalDocsExamined:   " + s.totalDocsExamined);
  print("executionTimeMillis: " + s.executionTimeMillis);
}

// Start from a clean state: remove all indexes except the default _id index,
// so the "before" explain() really runs without indexes.
db.tracks.dropIndexes();

// ======================================================
// Task 1. Query analysis and indexing
// ======================================================
print("\n========== Task 1 ==========");

const q1 = {
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
};
const sort1 = { popularity: -1 };

// 1) Before the index
showExplain(
  "Task 1 BEFORE index",
  db.tracks.find(q1).sort(sort1).explain("executionStats")
);

// 2) Create the index
// Field order follows the ESR rule (Equality, Sort, Range):
//   track_genre  - equality match ("pop")
//   popularity   - sort field (-1, same direction as the sort)
//   danceability - range condition ($gte)
// With this order MongoDB reads the "pop" tracks from the index already
// sorted by popularity, so no separate in-memory SORT stage is needed.
db.tracks.createIndex(
  { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
  { name: "genre_popularity_danceability" }
);

// 3) After the index
showExplain(
  "Task 1 AFTER index",
  db.tracks.find(q1).sort(sort1).explain("executionStats")
);

// ======================================================
// Task 2. Compound index for "music for work"
// fields: audio_features.instrumentalness, audio_features.speechiness, explicit
// ======================================================
print("\n========== Task 2 ==========");

const q2 = {
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 },
  explicit: false
};

// Before the index (only the Task 1 index exists, which does not fit this query)
showExplain(
  "Task 2 BEFORE index",
  db.tracks.find(q2).explain("executionStats")
);

// explicit goes first because it is an equality condition (ESR rule);
// the two range conditions follow.
db.tracks.createIndex(
  {
    explicit: 1,
    "audio_features.instrumentalness": 1,
    "audio_features.speechiness": 1
  },
  { name: "work_music" }
);

showExplain(
  "Task 2 AFTER index",
  db.tracks.find(q2).explain("executionStats")
);

// ======================================================
// Task 3 (optional). Covered query?
// Uses the index from Task 1: { track_genre, popularity, danceability }
// ======================================================
print("\n========== Task 3 ==========");

const q3 = { track_genre: "pop", popularity: { $gte: 70 } };

// The query exactly as given in the assignment (no projection)
showExplain(
  "Task 3 query as given (no projection)",
  db.tracks.find(q3).explain("executionStats")
);

// The same query with a projection that returns ONLY indexed fields
// and excludes _id
showExplain(
  "Task 3 with projection { _id: 0, track_genre: 1, popularity: 1 }",
  db.tracks
    .find(q3, { _id: 0, track_genre: 1, popularity: 1 })
    .explain("executionStats")
);

print("\nIndexes on tracks:");
printjson(db.tracks.getIndexes().map(i => i.name));
