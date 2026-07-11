"""pretrain.py — train the LinUCB policy in the market simulator and save its
state to agent_state.npz. Run once at build time; the service fine-tunes
online from live accept/reject feedback after deployment."""
import numpy as np
from market_sim import FreightMarketSim
from rl_agent import ACTIONS, LinUCBAgent

N = 80000
env = FreightMarketSim(seed=7)
agent = LinUCBAgent(env.N_FEATURES, alpha=0.6)
for ep in range(N):
    x = env.reset()
    done = False
    while not done:
        a = agent.act(x)
        x2, r, done, _ = env.step(float(ACTIONS[a]))
        agent.update(x, a, r)
        x = x2
np.savez("agent_state.npz", A=agent.A, b=agent.b, A_inv=agent.A_inv)
print(f"Pretrained LinUCB on {N:,} episodes -> agent_state.npz")
