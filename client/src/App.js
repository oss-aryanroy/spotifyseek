import React, { Component } from "react";
import "./App.css";
import PlaylistDropdown from "./components/playlist-dropdown";
import FileTypeDropdown from "./components/filetype-dropdown";
import Modal from "./components/Modal";
import SpotifyWebApi from "spotify-web-api-js";
const spotifyApi = new SpotifyWebApi();

class App extends Component {
  constructor() {
    super();
    const params = this.getHashParams();
    const token = params.access_token;
    if (token) {
      spotifyApi.setAccessToken(token);
    }
    this.state = {
      loggedIn: !!token,
      userPlaylists: [],
      fileTypePreference: "flac", // default file type
      fallbackFileTypePreference: "mp3", // if nothing is set
      selectedPlaylistID: "",
      progress: null,
      downloadStatus: "",
      previewUrl: null,
      isPreviewLoading: false,
      downloadInProgress: false,
      showDownloadBlockedModal: false,
      noSourceUris: [],
      currentDownloadingUri: null,
      fetchingSourceUri: null,
      autoDownloadProgress: 0, // 0–1 (0%–100%)
    };

    this.state = {
      ...this.state,
      trackList: [],
      candidateModalTrack: null,
      selectedCandidate: null,
      modalOpen: false,
    };
    this.audioRef = React.createRef();

    this.eventSource = null;
  }

  fetchCandidatesForTrack(track) {
    const artist = this.processForSearch(track.artist);
    const title = this.processForSearch(track.title);

    const params = new URLSearchParams({ artist, title });

    // mark this track as currently fetching
    this.setState({ fetchingSourceUri: track.uri });

    fetch(`http://127.0.0.1:8888/search-options?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];

        if (list.length === 0) {
          // no sources found
          this.setState((prev) => ({
            noSourceUris: prev.noSourceUris.includes(track.uri)
              ? prev.noSourceUris
              : [...prev.noSourceUris, track.uri],
            candidateList: [],
            modalOpen: true,
            candidateModalTrack: {
              artist: track.artist,
              title: track.title,
            },
          }));
        } else {
          // normal candidate list
          this.setState({
            candidateList: list,
            modalOpen: true,
            candidateModalTrack: {
              artist: track.artist,
              title: track.title,
            },
          });
        }
      })
      .catch((err) => {
        console.error(err);
        this.setState({
          candidateList: [],
          modalOpen: true,
          candidateModalTrack: {
            artist: track.artist,
            title: track.title,
            error: "Error searching for sources.",
          },
        });
      })
      .finally(() => {
        // clear loading state regardless of success/failure
        this.setState({ fetchingSourceUri: null });
      });
  }


  renderTrackList() {
    const {
      trackList,
      noSourceUris,
      fetchingSourceUri,
      currentDownloadingUri,
      downloadInProgress,
    } = this.state;

    if (!trackList || trackList.length === 0) return null;

    return (

      <div className="track-list-card">
        {/* Header: title + count + auto-download icon */}
        <div className="track-list-header">
          <h2 className="card-title">Tracks in playlist</h2>

          <div className="track-list-header-right">
            <span className="track-count">
              {trackList.length} track{trackList.length !== 1 ? "s" : ""}
            </span>


            <div className="header-download-wrapper">
              <button
                className={
                  "icon-btn auto-download-btn" +
                  (downloadInProgress ? " auto-download-btn-running" : "")
                }
                onClick={() => this.autoDownloadPlaylist()}
                disabled={trackList.length === 0 || downloadInProgress}
              >
                ⭳
              </button>

              <div className="auto-download-tooltip">
                <div className="tooltip-title">Auto-download playlist</div>
                <div className="tooltip-body">
                  This will automatically download each track using the first matching
                  source from Soulseek. Versions may differ slightly from the exact
                  Spotify release.
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Body: track rows */}
        <div className="track-list">
          {trackList.map((t, idx) => {
            const noSource = noSourceUris.includes(t.uri);
            const isFetching = fetchingSourceUri === t.uri;
            const isDownloading = currentDownloadingUri === t.uri;

            let label = "Choose source";
            if (noSource) label = "No sources";
            if (isFetching) label = "Fetching…";
            if (isDownloading) label = "Downloading…";

            const disabled = noSource || isFetching || isDownloading;

            return (
              <div key={t.uri || idx} className="track-row">
                <div className="track-main">
                  <span className="track-index">{idx + 1}</span>

                  <div className="track-text">
                    <div className="track-title">
                      {t.artist} – {t.title}
                    </div>
                    <div className="track-subtitle">
                      Choose a source from Soulseek, or use auto-download for
                      fastest results.
                    </div>
                  </div>
                </div>

                <div className="track-actions">
                  <button
                    className={
                      "btn track-choose-btn" +
                      (noSource ? " track-choose-btn-disabled" : "") +
                      (isFetching ? " track-choose-btn-loading" : "") +
                      (isDownloading ? " track-choose-btn-downloading" : "")
                    }
                    disabled={disabled}
                    onClick={() =>
                      !disabled && this.fetchCandidatesForTrack(t)
                    }
                  >
                    {label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  renderCandidateModal() {
    const { modalOpen, candidateList, candidateModalTrack } = this.state;
    if (!modalOpen || !candidateList) return null;

    return (
      <div className="candidate-modal-overlay">
        <div className="candidate-modal-card">
          <h3>Select source for:</h3>
          <p className="track-title">
            {candidateModalTrack.artist} – {candidateModalTrack.title}
          </p>

          <div className="candidate-list">
            {candidateList.length === 0 && (
              <p style={{ opacity: 0.7, marginTop: 16 }}>
                No audio sources found for this track.
              </p>
            )}

            {candidateList.map((cand, idx) => (
              <div key={idx} className="candidate-row">
                <div className="candidate-info">
                  {/* File name */}
                  <div className="candidate-filename">
                    {cand.file}
                  </div>

                  {/* Metadata */}
                  <div className="candidate-meta">
                    <strong>{cand.extension?.toUpperCase() || "??"}</strong>
                    {" • "}
                    {cand.size
                      ? `${(cand.size / (1024 * 1024)).toFixed(1)} MB`
                      : "Unknown size"}
                    {" • "}
                    {cand.bitrate ? `${cand.bitrate} kbps` : "Unknown bitrate"}
                    {" • "}
                    user: {cand.user || "Unknown"}
                    {" • "}
                    {cand.slots ? `${cand.slots} slots` : "no slots"}
                  </div>
                </div>

                <button
                  className="btn small-btn"
                  onClick={() => this.downloadSpecificCandidate(cand)}
                >
                  Download this file
                </button>
              </div>
            ))}
          </div>

          <button
            className="btn ghost-btn"
            onClick={() => this.setState({ modalOpen: false })}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  downloadSpecificCandidate(cand) {
    if (this.state.downloadInProgress) {
      this.setState({ showDownloadBlockedModal: true });
      this.setState({ modalOpen: false });
      return;
    }
    const { artist, title } = this.state.candidateModalTrack;

    fetch("http://127.0.0.1:8888/download-specific", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileInfo: cand, artist, title }),
    })
      .then((r) => r.json())
      .then((resp) => {
        if (resp.error) {
          alert("This source failed. Try another one.");
          this.setState({ downloadInProgress: false });
        } else {
          this.setState({ modalOpen: false });
        }
      })
      .catch((err) => {
        console.error(err);
        alert("Error downloading the selected file.");
      });
  }



  componentDidMount() {
    if (this.state.loggedIn) {
      spotifyApi.getMe().then((userData) => (this.userData = userData));
      this.getUserPlaylists();
      this.setupProgressEvents();
    }
  }

  componentWillUnmount() {
    if (this.eventSource) {
      this.eventSource.close();
    }
  }

  setupProgressEvents() {
    const es = new EventSource("http://127.0.0.1:8888/events");
    this.eventSource = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        this.setState({ progress: data });

        // STARTED downloading
        if (data.percent !== null && !data.done && !this.state.downloadInProgress) {
          this.setState({ downloadInProgress: true });
        }

        // FINISHED downloading
        if (data.done) {
          this.setState({ downloadInProgress: false });
        }

      } catch (e) {
        console.error("Error parsing SSE data", e);
      }
    };

    es.onerror = (err) => {
      console.error("EventSource error:", err);
    };
  }

  getHashParams() {
    const hashParams = {};
    let e;
    const r = /([^&;=]+)=?([^&;]*)/g;
    const q = window.location.hash.substring(1);
    e = r.exec(q);
    while (e) {
      hashParams[e[1]] = decodeURIComponent(e[2]);
      e = r.exec(q);
    }
    return hashParams;
  }

  fetchCandidates(artist, title) {
    const params = new URLSearchParams({ artist, title });

    fetch(`http://127.0.0.1:8888/search-options?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        console.log("search-options raw data:", data);

        const list = Array.isArray(data)
          ? data
          : (Array.isArray(data?.results) ? data.results : []);

        console.log("search-options candidateList length:", list.length);

        this.setState({
          candidateList: list,
          modalOpen: true,
          candidateModalTrack: { artist, title },
        });
      })
      .catch((err) => {
        console.error("search-options fetch error:", err);
        alert("No search results found.");
      });
  }

  getUserPlaylists() {
    spotifyApi.getUserPlaylists().then(
      (response) => {
        const playlistData = response.items.map((item) => ({
          id: item.id,
          name: item.name,
        }));

        this.setState(
          {
            userPlaylists: playlistData,
          },
          () => {
            if (this.state.userPlaylists.length > 0) {
              this.setState({
                selectedPlaylistID: this.state.userPlaylists[0].id,
              });
            }
          }
        );
      },
      (err) => {
        console.error("Error fetching playlists:", err);
      }
    );
  }

  autoDownloadPlaylist() {
    if (this.state.downloadInProgress) {
      this.setState({ showDownloadBlockedModal: true, modalOpen: false });
      return;
    }

    if (!this.state.selectedPlaylistID) {
      alert("No playlist selected.");
      return;
    }

    this.setState({
      downloadInProgress: true,
      downloadStatus: "Loading playlist from Spotify...",
      progress: null,
      noSourceUris: [],
      fetchingSourceUri: null,
      currentDownloadingUri: null,
    });

    spotifyApi.getPlaylist(this.state.selectedPlaylistID).then((response) => {
      const trackData = [];
      this.buildTrackData(response.tracks, trackData);

      const nextPage = response.tracks.next;

      this.readPages(nextPage, trackData).then(async () => {
        this.setState({
          trackList: trackData,
          downloadStatus: `Auto-downloading ${trackData.length} tracks (one by one)...`,
        });

        const noSourceUris = [];
        let finishedCount = 0;

        for (const track of trackData) {
          const rawArtist = track.artist;
          const rawTitle = track.title;

          const artist = this.processForSearch(rawArtist);
          const title = this.processForSearch(rawTitle);

          // show "fetching" on this track
          this.setState({
            downloadStatus: `Searching sources for: ${rawArtist} – ${rawTitle}`,
            fetchingSourceUri: track.uri,
            currentDownloadingUri: null,
          });

          try {
            const params = new URLSearchParams({
              artist,
              title,
              fileTypePreference: `.${this.state.fileTypePreference}`,
              fallbackFileTypePreference: this.state.fallbackFileTypePreference
                ? `.${this.state.fallbackFileTypePreference}`
                : ".mp3",
            });

            const searchRes = await fetch(
              `http://127.0.0.1:8888/search-options?${params.toString()}`
            );

            if (!searchRes.ok) {
              console.warn("Search failed for:", track.uri);
              noSourceUris.push(track.uri);
              this.setState({
                noSourceUris: [...noSourceUris],
                fetchingSourceUri: null,
                currentDownloadingUri: null,
              });
              continue;
            }

            const data = await searchRes.json();
            const candidates = Array.isArray(data) ? data : [];

            const audioCandidates = candidates.filter((c) =>
              ["mp3", "flac", "m4a", "aiff"].includes(
                (c.extension || "").toLowerCase()
              )
            );

            if (audioCandidates.length === 0) {
              noSourceUris.push(track.uri);
              this.setState({
                noSourceUris: [...noSourceUris],
                fetchingSourceUri: null,
                currentDownloadingUri: null,
              });
              continue;
            }

            const chosen = audioCandidates[0];

            // switch from "fetching" to "downloading" for this track
            this.setState({
              downloadStatus: `Downloading: ${rawArtist} – ${rawTitle}`,
              fetchingSourceUri: null,
              currentDownloadingUri: track.uri,
            });

            const dlRes = await fetch("http://127.0.0.1:8888/download-specific", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileInfo: chosen,
                artist: rawArtist,
                title: rawTitle,
              }),
            });

            const dlJson = await dlRes.json();

            if (dlJson.error) {
              console.warn("Download failed for", track.uri, dlJson.error);
              noSourceUris.push(track.uri);
              this.setState({ noSourceUris: [...noSourceUris] });
            }

          } catch (err) {
            console.error("Auto-download error for", track.uri, err);
            noSourceUris.push(track.uri);
            this.setState({ noSourceUris: [...noSourceUris] });
          }

          this.setState({
            autoDownloadProgress:
              (finishedCount + 1) / trackData.length,
          });

          // done with this track: clear per-track flags
          this.setState({
            fetchingSourceUri: null,
            currentDownloadingUri: null,
          });
        }

        // all done
        this.setState({
          downloadInProgress: false,
          fetchingSourceUri: null,
          currentDownloadingUri: null,
          downloadStatus:
            "Auto-download finished. You can still choose sources manually for any track.",
        });
      });
    });
  }

  sortDownloads() {
    if (!this.state.selectedPlaylistID) {
      alert("No playlist selected.");
      return;
    }

    if (
      window.confirm(
        "This will create a folder for the selected playlist and move all recorded downloads into it. Continue?"
      )
    ) {
      fetch("http://127.0.0.1:8888/sort-downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: this.state.selectedPlaylistID,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          alert(data.message || "Sort complete.");
        })
        .catch((err) => {
          console.error(err);
          alert("Error while sorting downloads.");
        });
    }
  }

  loadPlaylist() {
    if (this.state.downloadInProgress) {
      this.setState({ showDownloadBlockedModal: true, modalOpen: false });
      return;
    }

    if (!this.state.selectedPlaylistID) {
      alert("No playlist selected.");
      return;
    }

    this.setState({
      downloadStatus: "Loading playlist from Spotify...",
      progress: null,
    });

    spotifyApi.getPlaylist(this.state.selectedPlaylistID).then((response) => {
      const trackData = [];
      this.buildTrackData(response.tracks, trackData);

      const nextPage = response.tracks.next;

      this.readPages(nextPage, trackData).then(() => {
        this.setState({
          trackList: trackData,
          downloadStatus:
            "Playlist loaded. Choose a source for each track below, or use auto-download.",
          progress: null,
          noSourceUris: [], // reset any previous markings
        });
      });
    });
  }


  buildTrackData(page, trackData) {
    page.items.forEach((item) => {
      trackData.push({
        uri: item.track.uri,
        artist: item.track.artists[0].name,
        title: item.track.name,
      });
    });
  }

  async readPages(page, trackData) {
    return new Promise((resolve, reject) => {
      if (page) {
        return spotifyApi
          .getGeneric(page)
          .then((response) => {
            this.buildTrackData(response, trackData);
            resolve(this.readPages(response.next, trackData));
          })
          .catch((err) => {
            reject(err);
          });
      } else {
        resolve("done");
      }
    });
  }

  processForSearch(str) {
    return str
      .replaceAll("- ", "")
      .replaceAll("/", " ")
      .replaceAll("-", " ")
      .replaceAll(".", " ")
      .replaceAll("'", "")
      .replaceAll("...", "")
      .replaceAll("!", "")
      .replace("Original Mix", "");
  }

  setPlaylistID = (event) => {
    this.setState({
      selectedPlaylistID: event.target.value,
    });
  };

  setFileTypePreference = (event) => {
    this.setState({
      fileTypePreference: event.target.value,
    });
  };

  renderProgress() {
    const { progress, fileTypePreference } = this.state;
    if (!progress) return null;

    const percent =
      typeof progress.percent === "number" ? progress.percent : null;
    const speed = progress.speed ?? 0;
    const label = `${progress.artist || ""} – ${progress.title || ""}`;

    const displayType =
      (progress.fileType && progress.fileType.toUpperCase()) ||
      (fileTypePreference && fileTypePreference.toUpperCase());

    return (
      <div className="progress-card">
        <div className="progress-header">
          <div className="progress-title-row">
            <span className="track-dot">•</span>
            <span className="progress-title">{label}</span>

            {displayType && (
              <span className="file-pill">{displayType}</span>
            )}
          </div>

          {percent !== null && !progress.error && (
            <span className="progress-percent">
              {percent.toFixed(1)}%
            </span>
          )}
        </div>

        {progress.error ? (
          <p className="progress-error">Error: {progress.error}</p>
        ) : (
          <>
            <div className="progress-bar-outer">
              <div
                className="progress-bar-inner"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <p className="progress-meta">
              {percent === 100
                ? "Completed"
                : `${speed.toFixed ? speed.toFixed(2) : speed} MB/s`}
            </p>
          </>
        )}
      </div>
    );
  }

  render() {
    return (
      <div className="App">
        <div className="app-shell">
          <header className="app-header">
            <h1 className="app-title">Spotifyseek</h1>
            <p className="app-subtitle">
              Turn your Spotify playlists into Soulseek downloads.
            </p>
          </header>

          {!this.state.loggedIn && (
            <div className="card">
              <p className="card-text">
                Connect your Spotify account to see your playlists.
              </p>
              <a
                className="btn primary-btn"
                href="http://127.0.0.1:8888/"
              >
                Login with Spotify
              </a>
            </div>
          )}


          {this.state.showDownloadBlockedModal && (
            <div className="block-modal-overlay">
              <div className="block-modal-card">
                <h3 style={{ margin: 0 }}>A download is already in progress</h3>
                <p style={{ marginTop: 10, opacity: 0.8 }}>
                  Please wait for the current download to finish before starting another.
                </p>
                <button
                  className="btn primary-btn"
                  style={{ marginTop: 16 }}
                  onClick={() => this.setState({ showDownloadBlockedModal: false })}
                >
                  OK
                </button>
              </div>
            </div>
          )}


          {this.state.loggedIn && (
            <>
              <div className="card">
                <h2 className="card-title">Select playlist</h2>
                <PlaylistDropdown
                  dropdownChange={this.setPlaylistID}
                  playlistData={this.state.userPlaylists}
                />

                <h2 className="card-title" style={{ marginTop: "24px" }}>
                  File type
                </h2>
                <FileTypeDropdown
                  dropdownChange={this.setFileTypePreference}
                />

                <h2 className="card-title" style={{ marginTop: "18px" }}>
                  Fallback file type
                </h2>
                <FileTypeDropdown
                  dropdownChange={this.setFallbackFileTypePreference}
                />

                <div className="button-row">
                  <button
                    className="btn primary-btn"
                    onClick={() => this.loadPlaylist()}
                  >
                    Load playlist
                  </button>
                  <button
                    className="btn ghost-btn"
                    onClick={() => this.sortDownloads()}
                  >
                    Sort downloads
                  </button>
                </div>

              </div>

              {this.renderTrackList()}
              {this.renderCandidateModal()}
              {this.renderProgress()}
            </>
          )}
        </div>
      </div>
    );
  }
}

export default App;
