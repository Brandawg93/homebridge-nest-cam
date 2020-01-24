# homebridge-nest-cam2

View your Nest cams in HomeKit using [Homebridge](https://github.com/nfarina/homebridge) with this plugin.

## Notes
- This is a continuation of the previous [homebridge-nest-cam](https://github.com/KhaosT/homebridge-nest-cam) plugin.
- This plugin *does not* use the old access token authentication method as it is no longer supported.

## FAQ
Q: Why is there no audio?

A: Audio is not supported at this time.

Q: The video thumbnail is not updating.

A: This is a HomeKit issue and not a Homebridge issue. Rebooting your phone usually fixes it.

## Installation

1. Install ffmpeg
2. Install this plugin using: npm install -g homebridge-nest-cam2
3. Add google authentication to ``config.json``
3. Run [Homebridge](https://github.com/nfarina/homebridge)
4. Add extra camera accessories in Home app using the same setup code as [Homebridge](https://github.com/nfarina/homebridge)

On Raspberry Pi you might want to use OMX for transcoding as CPU on the board is too slow. In that case, make sure the ffmpeg you installed has `h264_omx` support and set `ffmpegCodec` above to `h264_omx`. There are [pre-compiled deb](https://github.com/legotheboss/homebridge-camera-ffmpeg-omx) online if you don't want to compile one yourself.

On MacOS you might want to use VideoToolbox hardware acceleration for transcoding. In that case, make sure the ffmpeg you installed has `videotoolbox` support and set `ffmpegCodec` to `h264_videotoolbox`.


### Setting up the Config.json

Setting up a Google Account with homebridge-nest is a pain, but only needs to be done once, as long as you don't log out of your Google Account.

Google Accounts are configured using the `"googleAuth"` object in `config.json`, which contains three fields, `"issueToken"`, `"cookies"` and `"apiKey"`, and looks like this:

```
{
    "platform": "Nest-cam",
    "ffmpegCodec": "libx264"
    "googleAuth": {
        "issueToken": "https://accounts.google.com/o/oauth2/iframerpc?action=issueToken...",
        "cookies": "SMSV=ADHTe...",
        "apiKey": "AIzaS..."
    }
}
```
The values of `"issueToken"`, `"cookies"` and `"apiKey"` are specific to your Google Account. To get them, follow these steps (only needs to be done once, as long as you stay logged into your Google Account).

1. Open a Chrome browser tab in Incognito Mode (or clear your cache).
2. Open Developer Tools (View/Developer/Developer Tools).
3. Click on 'Network' tab. Make sure 'Preserve Log' is checked.
4. In the 'Filter' box, enter `issueToken`
5. Go to `home.nest.com`, and click 'Sign in with Google'. Log into your account.
6. One network call (beginning with `iframerpc`) will appear in the Dev Tools window. Click on it.
7. In the Headers tab, under General, copy the entire `Request URL` (beginning with `https://accounts.google.com`, ending with `nest.com`). This is your `"issueToken"` in `config.json`.
8. In the 'Filter' box, enter `oauth2/iframe`
9. Several network calls will appear in the Dev Tools window. Click on the last `iframe` call.
10. In the Headers tab, under Request Headers, copy the entire `cookie` (beginning `SMSV=...` - **include the whole string which is several lines long and has many field/value pairs** - do not include the `cookie:` name). This is your `"cookies"` in `config.json`.
11. In the 'Filter' box, enter `issue_jwt`
12. Click on the last `issue_jwt` call.
13. In the Headers tab, under Request Headers, copy the entire `x-goog-api-key` (do not include the `x-goog-api-key:` name). This is your `"apiKey"` in `config.json`.

## Credits

This plugin was derived from [homebridge-nest-cam](https://github.com/KhaosT/homebridge-nest-cam) with the new google authentication from [homebridge-nest](https://github.com/chrisjshull/homebridge-nest).