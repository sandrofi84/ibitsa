// Entry point loaded by the extension's webview.
import './game.css';
import { startGame } from './boot';
import { webviewHost } from './host';

const root = document.getElementById('game');
if (!root) throw new Error('missing #game element');
startGame(root, webviewHost());
