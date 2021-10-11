*This file will be added to [the wiki](https://github.com/Brandawg93/homebridge-nest-cam/wiki/Manual-Authentication) and removed upon release.*

# Nest Authentication

## Deprecation Warning

Google has been making moves toward deprecating Nest accounts (and the Nest-based APIs), as announced here:
* [https://nest.com/whats-happening](https://nest.com/whats-happening/)

However, as of Q4 2021, the old Nest Token-based authentication **still functions** for those who have not migrated to Google accounts yet.

There is no guarantee how long these method will remain.

## Configuration

1. Cancel out of the initial authentication screen:<br>
   <img src="loginUI.png" width=450 />
2. Manually copy and paste this object template into your `config.json`, inside the `platforms` array:
    ```json
    {
        "nest_token": "TOKEN_GOES_HERE",
        "platform": "Nest-cam",
    }
    ```
3. Log into <a href="https://home.nest.com" target="_blank">https://home.nest.com</a> and get to the main home screen
4. Once authenticated, change the URL and navigate to <a href="https://home.nest.com/session" target="_blank">https://home.nest.com/session</a>
5. Grab the value associated with the `access_token` key:<br>
   <img src=home.Session.png width=600>
   * *Note: this is the same access_token that [homebridge-nest](https://github.com/chrisjshull/homebridge-nest) uses if you want to grab from existing config*
6. Update your `config.json` and the `nest_token` key with the access token you copied, replacing `TOKEN_GOES_HERE`
7. Make any additional modifications to the configuration based on the [available options](../README.md#options)
8. Save your configuration and restart the [child] bridge as necessary

**Notes:**
- All configuration must be done manually in your `config.json` - plugin-based config is not yet supported.