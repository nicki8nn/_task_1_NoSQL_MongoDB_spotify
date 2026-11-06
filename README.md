# _nosql_1 — MongoDB: Spotify Tracks Dataset Analysis

Loading ~114k Spotify tracks into MongoDB Atlas, transforming them into a document-oriented schema, and querying the data.

---

## Project structure

```
Surname_nosql_1/
├── README.md
├── requirements.txt
├── .env
├── .gitignore
├── dataset.csv
├── scripts/
│   ├── 01_load_data.py     # loads the CSV into the tracks_raw collection
│   └── 02_transform.js     # transforms tracks_raw → tracks
├── queries/
│   ├── part2_queries.js    # Part 2 queries
│   └── part3_indexes.js    # Part 3 indexes and explain()
├── results_part2.txt       # output of the Part 2 queries
└── results_part3.txt       # output of the Part 3 script
```

---

## Environment setup

### 1. MongoDB Atlas

1. Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas) and create a free **M0** cluster (provider: AWS).
2. **Database Access**: create a database user with a password.
3. **Network Access**: add your IP address (or `0.0.0.0/0` for development).
4. **Connect → Drivers**: copy the connection string `mongodb+srv://...`.

### 2. Python dependencies

Requires Python 3. From the project root folder:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Contents of `requirements.txt`:

```
pymongo==4.7.3
pandas==3.0.3
kaggle==1.6.14
python-dotenv==1.0.1
tqdm==4.66.4
```

### 3. The `.env` file

Create a `.env` file in the project root:

```
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/
```

`USER` and `PASSWORD` are the database user's credentials from **Database Access**, not the Atlas login.

### 4. Dataset

Download the **Spotify Tracks Dataset** from Kaggle and unzip `dataset.csv` into the project root folder.

### 5. mongosh

The JS scripts are run with the MongoDB Shell: [mongodb.com/try/download/shell](https://www.mongodb.com/try/download/shell).
Check the installation with `mongosh --version`.

---

## How to run

Run all commands from the project root folder.

```bash
# 1. Load the raw data into the tracks_raw collection
python scripts/01_load_data.py

# 2. Transform it into the tracks collection
mongosh "YOUR_MONGO_URI" --file scripts/02_transform.js

# 3. Run the Part 2 queries (output saved to a file)
mongosh "YOUR_MONGO_URI" --file queries/part2_queries.js > results_part2.txt

# 4. Optional: Part 3 indexes and explain() (output saved to a file)
mongosh "YOUR_MONGO_URI" --file queries/part3_indexes.js > results_part3.txt
```

Expected result after steps 1–2: the `spotify` database contains two collections, `tracks_raw` and `tracks`, with **113,999** documents each (one CSV row with a missing artist/track name is filtered out).

---

## Data schema of the `tracks` collection

Example document:

```json
{
  "_id": { "$oid": "6aec9ed900ca73d2f712a02e" },
  "track_id": "5SuOikwiRyPMVoIQDJUgSV",
  "album_name": "Comedy",
  "track_name": "Comedy",
  "popularity": 73,
  "duration_ms": 230666,
  "explicit": false,
  "track_genre": "acoustic",
  "artists": ["Gen Hoshino"],
  "audio_features": {
    "danceability": 0.676,
    "energy": 0.461,
    "loudness": -6.746,
    "speechiness": 0.143,
    "acousticness": 0.0322,
    "instrumentalness": 0.00000101,
    "liveness": 0.358,
    "valence": 0.715,
    "tempo": 87.917,
    "key": 1,
    "mode": 0,
    "time_signature": 4
  },
  "duration_sec": 230.7,
  "popularity_tier": "high"
}
```

| Field | Type | Description |
|---|---|---|
| `track_id` | string | Spotify track ID |
| `track_name`, `album_name` | string | Track and album name |
| `popularity` | int | Popularity, 0–100 |
| `duration_ms` | int | Duration in milliseconds |
| `duration_sec` | double | Duration in seconds (computed, 1 decimal place) |
| `explicit` | bool | Whether the track has explicit content |
| `track_genre` | string | Genre |
| `artists` | array of string | Artists (from the string `"A;B"` → `["A", "B"]`) |
| `audio_features` | object | Nested object with 12 audio features |
| `popularity_tier` | string | `high` (≥ 70), `medium` (40–69), `low` (< 40) |

Field types were verified with a `$type` query: `popularity` is int, `explicit` is bool, `artists` is array, `audio_features` is object, `audio_features.danceability` is double.

---

## Part 1 — Theory questions

### 1. Why are the audio features stored in a separate `audio_features` object instead of flat? When is nesting beneficial, and when does it cause problems?

The 12 audio features all describe one thing: how the track sounds. Putting them into one nested object makes the document easier to read. You can see at a glance which fields are metadata (name, album, genre, popularity) and which are the sound analysis. It also makes some queries simpler: with the projection `{ audio_features: 1 }` I get all 12 values with one field, instead of listing them one by one.

Nesting works well when the data belongs only to this one document and is usually read together with it. That's a 1:1 relationship: every track has exactly one set of audio features, and they never change size. In my queries, Task 1 and Task 4 filter only on `audio_features.*`, and dot notation (`"audio_features.danceability"`) worked without any problem.

Nesting also has costs. The paths in queries and indexes get longer, and it's easy to make a typo in them. Updating one value needs dot notation too. Nesting becomes a real problem when the nested data grows without limit (for example, a list of every play of a track), because a document can't exceed 16 MB. It's also a bad fit when the same data is shared by many documents. Then every copy has to be updated separately, and a separate collection with `$lookup` is the better choice.

### 2. Why are the artists stored as an array instead of a string? Which queries become easier?

In the CSV, the artists were one string, for example `"Drake;Future"`. To find all tracks by one artist in a string, I would need a regular expression. That's slow, because it can't use a normal index, and it's error-prone: searching for `"Drake"` would also match `"Drake Bell"`.

As an array (`["Drake", "Future"]`), each artist is a separate value. MongoDB searches inside arrays automatically, so `{ artists: "Drake" }` finds every track where Drake is one of the artists, exactly and without regex. An index on `artists` becomes a multikey index, with one index entry per artist, so these searches can be fast too.

The biggest difference for me was in aggregation. In Task 2, `$unwind: "$artists"` turns a track with two artists into two documents, one per artist. Then I can group by artist and count their tracks. With a string, I would first have to split it inside every query. Array operators like `$in`, `$all` and `$size` (for example, "tracks with more than one artist") also only work because `artists` is an array.

---

## Part 2 — Queries

File: [`queries/part2_queries.js`](queries/part2_queries.js). Full output: [`results_part2.txt`](results_part2.txt).

### Task 1. Party tracks

**Condition:** danceability > 0.7, energy > 0.7, duration 180,000–300,000 ms.

**How it works:** a `find()` with three conditions. The audio features are filtered with dot notation (`"audio_features.danceability"`), and the duration with a `$gte` / `$lte` range. The script prints the total count and the top 10 by popularity.

**Result:** 7,311 documents.

*My observations:* As a check, I ran the query with only the danceability and energy conditions, and it returned 12,475 tracks. The 3–5 minute limit removes about 5,000 of them, which makes sense, since many dance and electronic tracks are longer or shorter than that. One thing to keep in mind: 7,311 is the number of documents, not unique songs. The same track can appear in the dataset several times under different genres, so the number of distinct songs is a bit lower.

### Task 2. Artists whose tracks are all popular

**Condition:** at least 3 tracks, minimum popularity ≥ 60, top 20, with track count, minimum and average popularity (1 decimal place).

**How it works:**
1. `$unwind` on `artists`: one document per "track – artist" pair.
2. `$group` by `{ artist, track_id }`: the same track can appear in the dataset several times under different genres. Without this step, an artist with one song listed in three genres would get "3 tracks".
3. `$group` by artist: `$sum`, `$min`, `$avg`.
4. `$match`: `track_count ≥ 3` and `min_popularity ≥ 60`.
5. `$sort` by average popularity (descending), `$limit: 20`, `$round` to 1 decimal place.

**Result:** 20 artists (see `results_part2.txt`).

*My observations:* While building this query, I noticed that the dataset has duplicate tracks and the same `track_id` appears under several genres. Without the first `$group` by artist + `track_id`, an artist with one popular song listed in three genres would count as having "3 tracks" and wrongly pass the filter. That's why I count each track only once per artist. The task doesn't say what "top" means, so I chose to sort by average popularity: the artists whose popular tracks are, on average, the most popular come first. More than 20 artists qualify, so the `$limit: 20` returns exactly 20.

### Task 3. Unusual tracks (by tempo)

**Condition:** track tempo > genre average tempo + 2 × standard deviation (`$stdDevPop`).

**How it works:**
1. `$group` by `track_genre`: `$avg` and `$stdDevPop` of `audio_features.tempo`.
2. `$addFields`: `outlier_threshold = avg_tempo + 2 * std_tempo`.
3. `$lookup` with a pipeline: for each genre, goes back into `tracks` and selects the tracks of that genre with a tempo above the threshold.
4. `$match` keeps only genres with at least one such track; `$project` builds the fields `avg_tempo`, `genre`, `outlier_threshold`, `outlier_tracks`.

**Result:** unusual tracks were found in 112 of 114 genres.

*My observations:* The threshold "average + 2 standard deviations" means a track is much faster than what is typical for its genre. In a roughly normal distribution, only about 2–3% of values lie above it. Each genre gets its own threshold, which is the point of the task: a tempo of 180 BPM is unusual for acoustic music but normal for drum and bass. Outliers were found in 112 of the 114 genres. In the remaining two, no track is above the threshold. This query took noticeably longer than the others, because `$lookup` goes back into the whole `tracks` collection once for each genre.

### Task 4. Background tracks for work

**Condition:** loudness < -10, speechiness < 0.1, instrumentalness > 0.5, no explicit content.

**How it works:** a `find()` with four conditions. `explicit: false` works because the load script converted this field to a boolean.

**Result:** 9,324 documents.

*My observations:* All four conditions are realistic for focus music: quiet, almost no vocals or speech, mostly instrumental and no explicit lyrics. 9,324 documents is a large share of the dataset, which shows how much instrumental music there is in it, for example ambient, classical, piano and study-type genres. As in Task 1, this counts documents, so tracks listed under several genres appear more than once.

---

## Challenges and conclusions

The biggest challenge was not the queries but debugging. When I first ran `part2_queries.js`, every task returned 0 results, even though the data was loaded correctly. I checked step by step:

1. The collection had 113,999 documents, and the field types were correct (`int`, `double`, `bool`, `array`, `object`).
2. Each condition on its own returned results, for example 27,246 tracks with danceability > 0.7.
3. But two conditions together returned 0 from the file, while the same filter in the Atlas UI returned 12,475, and so did the same query typed directly into interactive `mongosh`.

So the problem was the file itself, not the logic. The file contained invisible Unicode characters (such as zero-width or non-breaking spaces). They can't be seen in VS Code, but MongoDB treated the affected field names as different fields that don't exist. A clean copy of the file fixed it immediately. My takeaway: when the same query gives different results in two tools, compare them step by step instead of rewriting the code.

About the document model: I understood that schema design in MongoDB starts from the queries you want to run. Nesting `audio_features` and turning `artists` into an array made the queries in Part 2 shorter and clearer. I also learned that real data needs checking. The duplicate tracks across genres would have given a wrong result in Task 2 if I hadn't noticed them.

---

## Part 3 — Indexes (optional)

File: [`queries/part3_indexes.js`](queries/part3_indexes.js). Full output: [`results_part3.txt`](results_part3.txt).

```bash
mongosh "YOUR_MONGO_URI" --file queries/part3_indexes.js > results_part3.txt
```

The script first removes all indexes except `_id`, so the "before" measurements really run without indexes. For each query it prints the plan stages and the key fields from `explain("executionStats")`.

### Task 1. Query analysis and indexing

Query: `track_genre: "pop"`, `audio_features.danceability >= 0.7`, sorted by `popularity` descending.

Index:

```js
db.tracks.createIndex(
  { track_genre: 1, popularity: -1, "audio_features.danceability": 1 },
  { name: "genre_popularity_danceability" }
)
```

Field order follows the **ESR rule** (Equality → Sort → Range): first the exact match on genre, then the sort field, then the range condition. This lets MongoDB read the "pop" tracks from the index already sorted, without a separate in-memory sort.

| explain() field | Before index | After index |
|---|---|---|
| Plan stages | `SORT <- COLLSCAN` | `FETCH <- IXSCAN (genre_popularity_danceability)` |
| nReturned | 354 | 354 |
| totalKeysExamined | 0 | 412 |
| totalDocsExamined | 113,999 | 354 |
| executionTimeMillis | 71 | 2 |

**What changed in the execution plan:** Without the index, MongoDB did a `COLLSCAN`: it read all 113,999 documents, kept the 354 that matched, and then sorted them in memory (`SORT` stage). With the index, the plan is `IXSCAN` followed by `FETCH`. MongoDB goes straight to the "pop" entries in the index, which are already ordered by popularity, so the `SORT` stage disappears completely. It read only 354 documents instead of 113,999, and the time dropped from 71 ms to 2 ms.

`totalKeysExamined` (412) is slightly higher than `nReturned` (354). Danceability is the last field in the index, after popularity. So MongoDB walks through the pop tracks in popularity order and skips the 58 that aren't danceable enough. That's the trade-off of the ESR rule: a few extra index keys in exchange for no in-memory sort.

**How to tell the index is used:** In `explain("executionStats")`:
- the winning plan contains the stage `IXSCAN` with `indexName: "genre_popularity_danceability"`, instead of `COLLSCAN`;
- `totalKeysExamined` is greater than 0 (412), so index keys were read;
- `totalDocsExamined` (354) is equal to `nReturned`, instead of the whole collection (113,999);
- there is no `SORT` stage, because the order comes from the index.

### Task 2. Compound index for "music for work"

```js
db.tracks.createIndex(
  { explicit: 1, "audio_features.instrumentalness": 1, "audio_features.speechiness": 1 },
  { name: "work_music" }
)
```

`explicit` comes first because it is an equality condition; the two range conditions follow.

| explain() field | Before index | After index |
|---|---|---|
| Plan stages | `COLLSCAN` | `FETCH <- IXSCAN (work_music)` |
| nReturned | 16,141 | 16,141 |
| totalKeysExamined | 0 | 16,602 |
| totalDocsExamined | 113,999 | 16,141 |
| executionTimeMillis | 119 | 37 |

*My observations:* After creating the index, the plan changed from `COLLSCAN` to `IXSCAN (work_music)`, so the index is used. MongoDB read 16,141 documents instead of 113,999, and the time dropped from 119 ms to 37 ms. The improvement is smaller than in Task 1 because the query still returns many documents (16,141). It's more than the 9,324 in Part 2, Task 4, because this query has no loudness condition. `totalKeysExamined` (16,602) is slightly higher than `nReturned`. With two range conditions, the index can narrow the scan precisely only for the first range field (instrumentalness). Speechiness is then checked on each index key along the way.

### Task 3. Is the query a covered query?

```js
db.tracks.find({ track_genre: "pop", popularity: { $gte: 70 } })
```

| explain() field | As given (no projection) | With `{ _id: 0, track_genre: 1, popularity: 1 }` |
|---|---|---|
| Plan stages | `FETCH <- IXSCAN (genre_popularity_danceability)` | `PROJECTION_COVERED <- IXSCAN (genre_popularity_danceability)` |
| nReturned | 317 | 317 |
| totalKeysExamined | 317 | 317 |
| totalDocsExamined | 317 | 0 |

*My answer:* No, the query as given is **not** a covered query. A query is covered when both the filter fields and all returned fields are in the index, so MongoDB can answer from the index alone, without opening any document.

The filter part fits: `track_genre` and `popularity` are the first two fields of the Task 1 index, so MongoDB uses it (`IXSCAN (genre_popularity_danceability)`). But the query has no projection, so it returns whole documents, including `_id`, `track_name`, `artists`, `audio_features` and so on. These fields are not in the index, so MongoDB has to load each document. You can see this in `explain()`: there is a `FETCH` stage, and `totalDocsExamined` is 317.

To make it covered, the query needs a projection that returns only indexed fields and excludes `_id` (which is not part of this index):

```js
db.tracks.find(
  { track_genre: "pop", popularity: { $gte: 70 } },
  { _id: 0, track_genre: 1, popularity: 1 }
)
```

My test confirms this. With that projection, the plan becomes `PROJECTION_COVERED <- IXSCAN`, with no `FETCH`, and `totalDocsExamined` is **0**, while it still returns the same 317 results.
