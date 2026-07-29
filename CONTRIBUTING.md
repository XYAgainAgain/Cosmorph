# Contributing to Cosmorph for Cool Cats

Howdy, thanks for being here, and welcome to the nebula factory! Whether you're here to report a bug, donate an idea, or sling some shader math, you are most welcome among these twinkly stars. Cosmorph is a one-person passion project, so every decent contribution genuinely matters (and is genuinely appreciated)!

## The Easy Ways to Help

- **Found a bug?** Open an [Issue](../../issues). Include your browser, your GPU, and the `?seed=` number if the problem is seed-specific. Screenshots adored!
- **Got an idea or a feature wish?** Also an Issue! Tell me what you want to see in the sky and why it would be cool. I keep a big ol' catalog of celestial phenomena to build and there's always room for more. Seriously please help me, space is so freaking big dude.
- **Made a gorgeous space scape?** Share the seed or the `.cosmos` file! Cool screenshots and presets make my whole ding-dang day, and standouts may get featured (with credit, always).
- **Typos, wonky text, busted sliders, broken links?** Fair game. Small PRs for small problems are just dandy, or you can just comment somewhere or hit me up on Discord lol.

## Contributing Code

A few things to know before you dive into the deep end with me:

1. **There is no build step, and that must remain so.** This repo is served exactly as-is: no bundler, no transpiler, no `npm install` at the root. If your change needs a toolchain to run, it probably needs a rethink. Vendored libraries live in `assets/vendor/` and I'm keeping 'em trim.
2. **Run it locally with any static server your like** from the repo root, for example `py -3 -m http.server 8000`, then open `http://localhost:8000/`. ES modules require a server; double-clicking `index.html` won't work.
3. **Test in more than one browser if you can!** I develop in/for Firefox; the engine also targets Chromium and Wallpaper Engine's embedded browser. WebGPU and WebGL2 should both produce the same image — `?gl=1` on the URL forces the WebGL2 path so you can compare.
4. **Match the code style please!** Sparse comments that explain *why* not *what*, no `px` font sizes in CSS, no inline styles or scripts in HTML. When in doubt, imitate the nearest existing file.
5. **Shader contributions have physics rules!** Nebula shaders output narrowband emission channels (Hα/OIII/SII), *never* raw RGB; and noise comes from the integer-hash library in `engine/shaders/tsl/noise.js` so every seed renders identically everywhere. A PR that breaks seed determinism will be lovingly turned away.
6. **Mind your sources!** Only contribute code you wrote or that carries a license compatible with commercial use (MIT, BSD, public domain). Shadertoy is full of gorgeous CC-BY-NC code that legally cannot go in here — reimplementing the *math* from a description is fine, pasting the code is not. If you asked an LLM to help you write some of it, I won't be too mad but I'll vet it extra hard.

Anyway, keep PRs focused, please! One idea per PR beats a mega-PR, and a few sentences or bullet points about what changed and why helps me merge your cool space stuff faster. If you're planning something big, open an Issue first so we can talk it through before you spend your weekend on it. :)

## The Legal Bit

Cosmorph is licensed under [PolyForm Noncommercial 1.0.0](LICENSE.md), and paid builds are part of the plan. **By contributing, you agree your contribution can be used in all versions of Cosmorph, including any/all future paid builds.** In exchange, worthwhile contributions earn you a free copy of the paid version on every platform, plus your name in the credits. I think that's a fair trade, but it only works if you know about it going in. So, uh, now you do. Okay thank you I love you byebye!

## Contact (If You Dare)

- Discord: **XYAgain**
- Email: **sam@tkb.band**

<p align="center">✨🧡🌌</p>
