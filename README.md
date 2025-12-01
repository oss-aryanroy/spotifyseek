# Spotifyseek
Download your spotify playlist from soulseek, which a P2P (Peer-to-Peer) network.

## This project used [Spotifyseek](https://github.com/bdavs3/spotifyseek) as its base, with huge improvements added.
- Upgraded from React 17 to React 19 compatability.
- Added a fallback type for playlist to be downloaded from.
- Vastly improve the UI from basic to modern look with added features.
- Added a source selection option to be chosen from all search results on Soulseek
- Added progress bars to downloads along with download restriction for one file at a time.
- Added proper timeouts and updated the code to match with spotify's new callback URI guidelines.
- Fixed outdated slsk-client usage, which caused the program not to work.


## TODO
- Make sort downloads functional so downloaded playlist is tracked, and all songs downloaded using a playlist are transferred into a file.
- Add YouTube as an option for music playlist
- Fixing a small bug where candidates are sometimes skipped due to an unknown `cb` TypeError from slsk-client
- Add a proper download animation to the download entire playlist option.

## Usage:
You would need to create a developer application, which is free of cost and instant in terms of creation.
1. Head over to [Spotify Developer Dashboard](https://developer.spotify.com)
2. Login to your spotify account (the one you want to download your music files for)
3. Click on your profile on top-right and navigate to `dashboard`
4. Click on `Create App` and fill in the details.
5. For `redirect URI` add `http://127.0.0.1:8888/callback` and `http://127.0.0.1:3000/callback`
6. After creation, you will obtain `CLIENT_ID` and `CLIENT_SECRET` (Client Secret needs to be regenerated in order to be seen)

Unlike the original project, I am utilizing `.env` file instead of directly setting environment variables.
The following variables need to be set:
- `SPOTIFY_CLIENT_ID`: your `CLIENT_ID` from spotify developer application.
- `SPOTIFY_CLIENT_SECRET`: your `CLIENT_SECRET` from spotify developer application
- `USERNAME`: your `USERNAME` for soulseek, if you don't have one, pick any (you don't need to create it)
- `PW`: your `PASASWORD` for soulseek, if you don't have an account, just set it to anything (you don't need to create it)

I have included a `.env.example` file, just rename it to `.env` and change the placeholder values in it.

To start the website, you will need to do it twice. Once for the server, and one for the client. You need `node.js` installed.
Use following steps to use this project:
1. Clone/Download this repository to your local PC/Laptop.
2. Make sure you have followed instructions writte above.
3. Open your command prompt/termina and make sure you are on the root foldeer, i.e inside the cloned repository.
4. Type `npm install` and let it install all the required files from `package.json`
5. After this, open another terminal in the same location.
6. From first terminal, `cd` into `server` folder and type `node .` and wait for it to display "Connected to Soulseek" as shown below
   <img width="449" height="125" alt="image" src="https://github.com/user-attachments/assets/dafc9392-1ee6-45f3-831d-7451cb03dffb" />
7. From second terminal, `cd` into `client` folder and type `npm start`. After the client is running, it should open your browser automatically, where you will be shown a `login with spotify` option.
8. Login with spotify, and authorize the OAuth page.
9. This will redirect you back to website, where you should now see your playlists from a dropdown.

The UI is pretty easy to understad, it comes with a `Load Playlist` option and a `Sort Downloads` option (TODO).
`Load Playlist` loads your playlist and displays all the tracks.

You can check the images provided below for the website for a better understanding.

## The Website
<img width="1876" height="1002" alt="image" src="https://github.com/user-attachments/assets/73d3711d-a962-4310-8418-e04cf1a0d222" />
<img width="1874" height="1004" alt="image" src="https://github.com/user-attachments/assets/a577af22-ab2d-4845-b759-21c191646148" />
<img width="1877" height="995" alt="image" src="https://github.com/user-attachments/assets/f1204670-28f7-42ba-8304-0ad8ba463ec5" />
<img width="1876" height="995" alt="image" src="https://github.com/user-attachments/assets/25eaa99d-b5ef-4266-b74d-af4c36e64fa0" />


## Disclaimer
This software can only install music that is offered by users on the P2P network of Soulseek. If a music is not present, it **WILL** be promptly skipped.
