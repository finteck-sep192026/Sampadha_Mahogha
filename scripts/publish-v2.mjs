// Publishes the Sampadha-v2 folder as the root of branch deploy-v2, which Hostinger's Git
// deployment serves at racrm.fintecindia.com. Commit your changes on main first, then:
//   npm run publish:v2
// and press Deploy in hPanel (or let the auto-deploy webhook do it).
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('subtree', 'split', '--prefix', 'Sampadha-v2');
git('push', 'origin', `${commit}:refs/heads/deploy-v2`);
console.log(`deploy-v2 -> ${commit.slice(0, 7)}`);
