module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Path aliases. `@/*` is the app itself; `@shared/*` reaches the folder
      // shared with the website (see metro.config.js watchFolders) so the app
      // and niyomwealth.com run the same portfolio, gains and partner logic.
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            '@shared': '../shared',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      // Must stay LAST. Reanimated 4 ships its worklet transform in
      // react-native-worklets; the old 'react-native-reanimated/plugin' is a
      // no-op shim in v4 and would silently leave worklets untransformed.
      'react-native-worklets/plugin',
    ],
  };
};
