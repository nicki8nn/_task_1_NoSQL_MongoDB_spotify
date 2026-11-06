

db = db.getSiblingDB("spotify");

// ======================================================
// Task 1. Party tracks
// danceability > 0.7, energy > 0.7, duration 180000-300000 ms
// ======================================================
const partyFilter = {
  "audio_features.danceability": { $gt: 0.7 },
  "audio_features.energy": { $gt: 0.7 },
  duration_ms: { $gte: 180000, $lte: 300000 }
};

const partyTracks = db.tracks
  .find(partyFilter, {
    _id: 0,
    track_name: 1,
    artists: 1,
    track_genre: 1,
    popularity: 1,
    duration_sec: 1,
    "audio_features.danceability": 1,
    "audio_features.energy": 1
  })
  .sort({ popularity: -1 })
  .limit(10)
  .toArray();

print("\n=== Task 1: Party tracks ===");
print("Found: " + db.tracks.countDocuments(partyFilter));
print("Top 10 by popularity:");
printjson(partyTracks);

// ======================================================
// Task 2. Artists whose tracks are all popular
// at least 3 tracks AND min popularity >= 60
// top 20, with track count, min and avg popularity (1 decimal)
// ======================================================
const popularArtists = db.tracks.aggregate([
  // One document per (track, artist): "Drake; Future" -> 2 documents
  { $unwind: "$artists" },

  // The same track can appear under several genres (same track_id).
  // Group by artist + track_id so each track is counted only once per artist.
  {
    $group: {
      _id: { artist: "$artists", track_id: "$track_id" },
      popularity: { $max: "$popularity" }
    }
  },

  // Now group by artist only
  {
    $group: {
      _id: "$_id.artist",
      track_count: { $sum: 1 },
      min_popularity: { $min: "$popularity" },
      avg_popularity: { $avg: "$popularity" }
    }
  },

  // Keep only "popular" artists
  { $match: { track_count: { $gte: 3 }, min_popularity: { $gte: 60 } } },

  // "Top": highest average popularity first, then more tracks
  { $sort: { avg_popularity: -1, track_count: -1 } },
  { $limit: 20 },

  {
    $project: {
      _id: 0,
      artist: "$_id",
      track_count: 1,
      min_popularity: { $round: ["$min_popularity", 1] },
      avg_popularity: { $round: ["$avg_popularity", 1] }
    }
  }
]).toArray();

print("\n=== Task 2: Top 20 artists with all tracks popular ===");
printjson(popularArtists);

// ======================================================
// Task 3. Tracks with unusually high tempo for their genre
// tempo > genre avg + 2 * genre stdDevPop
// ======================================================
const tempoOutliers = db.tracks.aggregate([
  // Step 1: statistics per genre
  {
    $group: {
      _id: "$track_genre",
      avg_tempo: { $avg: "$audio_features.tempo" },
      std_tempo: { $stdDevPop: "$audio_features.tempo" }
    }
  },

  // Step 2: threshold = avg + 2 * std
  {
    $addFields: {
      outlier_threshold: {
        $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }]
      }
    }
  },

  // Step 3: go back to the tracks collection and pick tracks
  // of this genre whose tempo is above the threshold
  {
    $lookup: {
      from: "tracks",
      let: { genre: "$_id", threshold: "$outlier_threshold" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$track_genre", "$$genre"] },
                { $gt: ["$audio_features.tempo", "$$threshold"] }
              ]
            }
          }
        },
        {
          $project: {
            track_name: 1,
            popularity: 1,
            artists: 1,
            "audio_features.tempo": 1
          }
        }
      ],
      as: "outlier_tracks"
    }
  },

  // Keep only genres that actually have outliers
  { $match: { "outlier_tracks.0": { $exists: true } } },

  {
    $project: {
      _id: 0,
      avg_tempo: { $round: ["$avg_tempo", 1] },
      genre: "$_id",
      outlier_threshold: { $round: ["$outlier_threshold", 1] },
      outlier_tracks: 1
    }
  },
  { $sort: { genre: 1 } }
]).toArray();

print("\n=== Task 3: Tempo outliers per genre ===");
print("Genres with outliers: " + tempoOutliers.length);
tempoOutliers.forEach(g =>
  print(
    g.genre +
      " | avg " + g.avg_tempo +
      " | threshold " + g.outlier_threshold +
      " | outliers: " + g.outlier_tracks.length
  )
);
print("Full result for the first genre:");
printjson(tempoOutliers[0]);

// ======================================================
// Task 4. Background tracks for work
// loudness < -10, speechiness < 0.1, instrumentalness > 0.5, not explicit
// ======================================================
const workFilter = {
  "audio_features.loudness": { $lt: -10 },
  "audio_features.speechiness": { $lt: 0.1 },
  "audio_features.instrumentalness": { $gt: 0.5 },
  explicit: false
};

const workTracks = db.tracks
  .find(workFilter, {
    _id: 0,
    track_name: 1,
    artists: 1,
    track_genre: 1,
    explicit: 1,
    "audio_features.loudness": 1,
    "audio_features.speechiness": 1,
    "audio_features.instrumentalness": 1
  })
  .sort({ popularity: -1 })
  .limit(10)
  .toArray();

print("\n=== Task 4: Background tracks for work ===");
print("Found: " + db.tracks.countDocuments(workFilter));
print("Top 10 by popularity:");
printjson(workTracks);
