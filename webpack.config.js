const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const entries = {
  hub: "./src/entries/hub.tsx",
  "pr-tab": "./src/entries/pr-tab.tsx",
  "pr-action": "./src/entries/pr-action.tsx"
};

module.exports = (env, argv) => {
  const dev = argv.mode === "development";
  return {
    entry: entries,
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      clean: true
    },
    devtool: dev ? "eval-source-map" : false,
    resolve: { extensions: [".ts", ".tsx", ".js"] },
    module: {
      rules: [
        { test: /\.tsx?$/, loader: "ts-loader", exclude: /node_modules/, options: { transpileOnly: true } },
        { test: /\.scss$/, use: ["style-loader", "css-loader", "sass-loader"] },
        { test: /\.css$/, use: ["style-loader", "css-loader"] }
      ]
    },
    plugins: Object.keys(entries).map(
      (name) =>
        new HtmlWebpackPlugin({
          filename: `${name}.html`,
          chunks: [name],
          title: "Stacked Pull Requests",
          template: "./static/index.html"
        })
    ),
    performance: { hints: false },
    devServer: {
      port: 3000,
      server: "https",
      hot: true,
      headers: { "Access-Control-Allow-Origin": "*" },
      static: false
    }
  };
};
