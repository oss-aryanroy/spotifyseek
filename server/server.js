import express from "express";
import querystring from "querystring";
import cors from "cors";
import cookieParser from "cookie-parser";
import got from "got";
import symbols from "log-symbols";
import chalk from "chalk";
import path from "path";
import { fileURLToPath } from "url";
import Slsk, { slskEvents } from "./slsk.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
import dotenv from "dotenv";
dotenv.config()

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SLSK_USER = process.env.USERNAME;
const SLSK_PW = process.env.PW;

const REDIRECT_URI = "http://127.0.0.1:8888/callback"; // cannot be localhost due to Spotify restrictions
const SCOPE =
  "playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";
const STATE_KEY = "spotify-auth-state";

export default class Server {

  constructor() {
    this.playlistFiles = {}; // Maps playlist IDs to file paths.
    this.authCode = null; // Granted after Spotify user approves access.
    this.access_token = null; // Exchanged for auth code. Needed for API calls.
    this.userId = null; // Spotify user ID
    this.failedDownloads = []; // Stores song IDs of failed downloads.

    this.slsk = new Slsk(SLSK_USER, SLSK_PW);
  }

  serveExpress() {
    let app = express();

    app
      .use(express.static(__dirname + "/public"))
      .use(express.json())
      .use(cors())
      .use(cookieParser());

    app.get("/events", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (res.flushHeaders) res.flushHeaders();

      const onProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      slskEvents.on("progress", onProgress);

      req.on("close", () => {
        slskEvents.removeListener("progress", onProgress);
        res.end();
      });
    });

    app.get("/login", (req, res) => {
      let state = generateRandomString(16);
      res.cookie(STATE_KEY, state);

      res.redirect(
        "https://accounts.spotify.com/authorize?" +
        querystring.stringify({
          response_type: "code",
          client_id: CLIENT_ID,
          scope: SCOPE,
          redirect_uri: REDIRECT_URI,
          state: state,
        })
      );
    });

    app.get("/callback", (req, res) => {
      let authCode = req.query.code || null;
      let state = req.query.state || null;
      let storedState = req.cookies ? req.cookies[STATE_KEY] : null;

      if (state === null || state !== storedState) {
        res.redirect(
          "/#" +
          querystring.stringify({
            error: "state_mismatch",
          })
        );
      } else {
        res.clearCookie(STATE_KEY);

        (async () => {
          await this.setAccessToken(authCode);

          await res.redirect(
            "http://127.0.0.1:3000/#" +
            querystring.stringify({
              access_token: this.access_token,
              refresh_token: this.refresh_token,
            })
          );
        })();
      }
    });

    app.get("/search-options", (req, res) => {
      const { artist, title } = req.query;

      if (!artist || !title) {
        return res.status(400).json({ error: "artist and title required" });
      }

      this.slsk
        .fetchSearchOptions(artist, title)
        .then((results) => {
          // IMPORTANT: send the array directly
          res.json(results);
        })
        .catch((err) => {
          console.error("search-options error:", err);
          res.status(500).json({ error: String(err) });
        });
    });



    app.post("/download-specific", async (req, res) => {
        const { fileInfo, artist, title } = req.body;

        if (!fileInfo) {
            return res.status(400).json({ error: "fileInfo required" });
        }

        this.slsk.downloadSpecific(fileInfo, artist, title)
            .then(result => res.json(result))
            .catch(err => res.status(500).json({ error: String(err) }));
    });

    app.post("/download", async (req, res) => {
      this.failedDownloads = [];

      const { tracks, fileTypePreference, fallbackFileTypePreference, playlistId, playlistName } =
    req.body;

      let clientMsg = `Downloading ${req.body.tracks.length} tracks...`;
      res.send(JSON.stringify(clientMsg));

      let downloadCounter = 0;
      let successCounter = 0;

      if (!this.playlistFiles[playlistId]) {
        this.playlistFiles[playlistId] = {
          name: playlistName || playlistId,
          files: [],
        };
      }

      for (const track of req.body.tracks) {
        let uri = track.uri;
        let artist = track.artist;
        let title = track.title;

        writeDownloadProgress(
          ++downloadCounter,
          req.body.tracks.length,
          artist,
          title
        );

        await this.slsk
          .download(artist, title, fileTypePreference, fallbackFileTypePreference)
          .then(() => {
            successCounter++;
            labelDownloadResult();
          })
          .catch((err) => {
            this.failedDownloads.push(uri);
            labelDownloadResult(err);
          });
        if (downloadCounter === req.body.tracks.length) {
          console.log(
            chalk.green(
              `Complete! ${successCounter} of ${req.body.tracks.length}
                downloaded successfully.`
            )
          );
        }
      }
    });

    app.get("/tracker", (req, res) => {
      res.send(JSON.stringify(this.failedDownloads));
    });

    app.post("/sort-downloads", (req, res) => {
      const { playlistId } = req.body;
      const entry = this.playlistFiles[playlistId];

      if (!entry || !entry.files || entry.files.length === 0) {
        return res
          .status(400)
          .json({ message: "No recorded downloads for this playlist." });
      }

      const playlistNameSafe = entry.name
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, " ")
        .trim() || playlistId;

      const targetDir = path.join(
        os.homedir(),
        "Music",
        "Spotifyseek",
        playlistNameSafe
      );

      fs.mkdirSync(targetDir, { recursive: true });

      let moved = 0;
      entry.files.forEach((filePath) => {
        if (!fs.existsSync(filePath)) return;
        const base = path.basename(filePath);
        const dest = path.join(targetDir, base);

        try {
          fs.renameSync(filePath, dest);
          moved++;
        } catch (e) {
          console.error("Error moving file", filePath, "->", dest, e);
        }
      });

      return res.json({
        message: `Moved ${moved} files to ${targetDir}`,
      });
    });

    app.listen(8888, () => {
      console.log("Listening on 8888...");
    });


  }

  // Exchanges authorization code for access token, as outlined here:
  // https://developer.spotify.com/documentation/general/guides/authorization-guide/#authorization-code-flow
  async setAccessToken(authCode) {
    let options = {
      url: "https://accounts.spotify.com/api/token",
      form: {
        code: authCode,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      },
      headers: {
        Authorization:
          "Basic " +
          new Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString("base64"),
      },
      json: true,
    };

    try {
      const response = await got.post(options.url, {
        form: options.form,
        headers: {
          Authorization:
            "Basic " +
            new Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString("base64"),
        },
      });

      let body = JSON.parse(response.body);

      this.access_token = body.access_token;
      this.refresh_token = body.refresh_token;
    } catch (err) {
      console.log(`err in setAccessToken:\n${err.message}`);
    }
  }
}

function generateRandomString(length) {
  let text = "";
  let possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function writeDownloadProgress(count, total, artist, title) {
  let msg =
    count > total
      ? "Complete!"
      : `Downloading ${count} of ${total}, '${title}' by ${artist}... `;

  process.stdout.write(msg);
}

function labelDownloadResult(err = "") {
  if (!err) {
    process.stdout.write(chalk.green(`${symbols.success} success\n`));
  } else {
    process.stdout.write(chalk.red(`${symbols.error} ${err}\n`));
  }
}

function sortCandidates(candidates) {
  const priority = {
    ".flac": 1,
    ".mp3": 2,
  };
  
  return candidates.sort((a, b) => {
    const extA = a.extension?.toLowerCase() || "";
    const extB = b.extension?.toLowerCase() || "";
    const priA = priority[extA] || 99; 
    const priB = priority[extB] || 99;

    // 1. sort by extension preference (FLAC first)
    if (priA !== priB) return priA - priB;

    // 2. If same extension: sort by bitrate descending
    if ((a.bitrate || 0) !== (b.bitrate || 0)) {
      return (b.bitrate || 0) - (a.bitrate || 0);
    }

    // 3. If same bitrate: sort by size descending
    return (b.size || 0) - (a.size || 0);
  });
}

function isAudioExtension(ext) {
  if (!ext) return false;
  ext = ext.toLowerCase();

  const allowed = [".mp3", ".flac", ".m4a", ".aiff", ".aac", ".wav", ".ogg"];
  return allowed.includes(ext);
}


