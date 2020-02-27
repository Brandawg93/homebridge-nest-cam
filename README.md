# homebridge-nest-cam2

View your Nest cams in HomeKit using [Homebridge](https://github.com/nfarina/homebridge) with this plugin.

[![NPM](https://nodei.co/npm/homebridge-nest-cam2.png?compact=true)](https://nodei.co/npm/homebridge-nest-cam2/)

[![PayPal](https://img.shields.io/badge/paypal-donate-yellow)](https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=CEYYGVB7ZZ764&item_name=homebridge-nest-cam2&currency_code=USD&source=url)
[![Discord](https://img.shields.io/discord/681137725071425676)](https://discord.gg/E6dnwsE)
[![Downloads](https://img.shields.io/npm/dt/homebridge-nest-cam2)](https://nodei.co/npm/homebridge-nest-cam2/)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/df36db66217e4b96bd5994b42a6e27f2)](https://www.codacy.com/manual/Brandawg93/homebridge-nest-cam2?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=Brandawg93/homebridge-nest-cam2&amp;utm_campaign=Badge_Grade)

## Notes
- This is a continuation of the previous [homebridge-nest-cam](https://github.com/KhaosT/homebridge-nest-cam) plugin.
- This plugin *does not* use the old access token authentication method as it is no longer supported.

## FAQ
Q: Why is there no audio?

A: Audio is not supported at this time. For more info, please read this [issue](https://github.com/Brandawg93/homebridge-nest-cam2/issues/1).

Q: How do I enable motion detection alerts?

A: Open the camera feed and press the settings gear in the top left. Select notifications and enable "Notifications on this device".

Q: Why is the stream slow/lagging/skipping?

A: Your device running Homebridge must encode the stream into a format that iOS can recognize. This requires significant processing power for devices such as a Raspberry Pi. For more info, please read this [issue](https://github.com/Brandawg93/homebridge-nest-cam2/issues/15).

**Other asked questions can be found [here](https://github.com/Brandawg93/homebridge-nest-cam2/issues?utf8=%E2%9C%93&q=label%3Aquestion+).**

## Installation
1. Install ffmpeg
2. Install this plugin using: npm install -g homebridge-nest-cam2
3. Add google authentication to ``config.json``
3. Run [Homebridge](https://github.com/nfarina/homebridge)
4. Add extra camera accessories in Home app using the same setup code as [Homebridge](https://github.com/nfarina/homebridge)

#### Raspberry Pi
You may want to use OMX for transcoding as the CPU on the board can be slow. If so, make sure the ffmpeg installed on your Pi has `h264_omx` support and set the `ffmpegCodec` option below to `h264_omx`. You can always compile ffmpeg from source using [these instructions](https://github.com/legotheboss/YouTube-files/wiki/(RPi)-Compile-FFmpeg-with-the-OpenMAX-H.264-GPU-acceleration).

#### Mac OS
You may want to use VideoToolbox hardware acceleration for transcoding. If so, make sure the ffmpeg installed on your Mac has `videotoolbox` support and set `ffmpegCodec` option below to `h264_videotoolbox`.

#### Docker
The Homebridge Docker container requires an extra environment variable to install ffmpeg: `PACKAGES=ffmpeg`. The Docker container also requires the `libx264` codec as it uses the ffmpeg inside the container and not the ffmpeg on the device running the container.

### Setting up the Config.json
Setting up a Google Account with homebridge-nest is a pain, but only needs to be done once, as long as you do not log out of your Google Account.

Google Accounts are configured using the `"googleAuth"` object in `config.json`, which contains three fields, `"issueToken"`, `"cookies"` and `"apiKey"`, and looks like this:

```
{
    "platform": "Nest-cam",
    "ffmpegCodec": "libx264",
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
10. In the Headers tab, under Request Headers, copy the entire `cookie` (**include the whole string which is several lines long and has many field/value pairs** - do not include the `cookie:` name). This is your `"cookies"` in `config.json`.
11. In the 'Filter' box, enter `issue_jwt`
12. Click on the last `issue_jwt` call.
13. In the Headers tab, under Request Headers, copy the entire `x-goog-api-key` (do not include the `x-goog-api-key:` name). This is your `"apiKey"` in `config.json`.
14. Do not log out of `home.nest.com`, as this will invalidate your credentials. Just close the browser tab.

## Join the Discord
Unfortunately, there is no way for me to test every subscription, camera type, and feature. If you would like to help me test new features and enhancements, join the [Discord Server](https://discord.gg/E6dnwsE) and let me know what you would like to test. Also, if you have general questions or support, feel free to [ask in the server](https://discord.gg/e7bPJnJ).

## Credits
This plugin was derived from [homebridge-nest-cam](https://github.com/KhaosT/homebridge-nest-cam) with the new google authentication from [homebridge-nest](https://github.com/chrisjshull/homebridge-nest).

Nest Hello doorbell resolution by [schmittx](https://github.com/schmittx/homebridge-nest-cam/commit/0878058dc5293c297a99c3a0c60d6c1b43e661b5).
