# serverless-emoticon-faceswap

## Setting up your development environment
We use `direnv` and `nvm` to automatically load the correct version of Node, NPM and Serverless Framework into the shell.

### nvm
Use the install script for [Node Version Manager](https://github.com/creationix/nvm#install-script) then run the following command in your terminal
```
npm install -g avn avn-nvm && avn setup
```

### direnv
OSX users can install direnv using [Homebrew](http://brew.sh/)
```
brew install direnv
```

Add the following line to your `.bash_profile`

```
eval "$(direnv hook bash)"
```

or if you use zsh enter this to your `.zshrc`

```
eval "$(direnv hook zsh)"
```

### Enabling direnv
Once the above are installed, navigate to the project root and the following to install npm modules (including serverless) and run the environment loader
```
npm install && direnv allow .
```

### Create your .env file(s)
You need to create a `.env-dev-deploy` file to deploy the project to your environment

```
AWS_PROFILE=your_dev_profile
AWS_REGION=us-east-1
```

If you want to load more environment variables create more `.env-xx` files to load variables.
