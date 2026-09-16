# Secure Connect Portal

I want to develop full stack web application for VPN Self Service Portal for Clients/Users.

i have openvpn 2.7.6 server installed on RHEL9.8. I have also integrated google authenticator with openvpn using PAM.

Users' Home Directory have .google_authenticator file. You may check user's Home Directory Path by following command: getent passwd <USERNAME> | awk -F: '{print $6}'. All Users' ovpn files path is: /etc/openvpn/client/ovpn-files/<USERNAME>.ovpn.

Now i want to create web application in which i want user auth, then usre get options: Welcome Prompt, Right Corner Logout, Generate Google Authenticator QR ( It should show generated QR & Code Both), Get Your Client FIle ( User can download only his/her ovpn file from my give path). Also Show User's Google Authenticator QR Generation History with Date & Time & ovpn file Download History with Date & Time.

Also Ensure that This web application should not be having any vulnerabilities or any security loops. This web application should be built on bes available Production based Packages and modules.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fb4aba4c-e23c-49d9-a90e-7cb7c160a386).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
