"""
rl_agent.py — LAYER 3: reinforcement-learning quote policy.

Two production-staged learners over a discrete action set of price
multipliers applied to the Layer-2 market rate (Layer-1 floor enforced by
the environment/engine, so exploration can never quote below cost):

  ACTIONS = [0.90, 0.94, 0.98, 1.02, 1.06, 1.12, 1.20]

1) LinUCBAgent   — contextual bandit (cold-start / first 90 days in prod):
                   per-arm ridge regression with UCB exploration bonus.
                   Safe, interpretable, no simulator needed in production.
2) LinearQAgent  — Q-learning with linear function approximation over the
                   2-step (outbound -> backhaul) episode, so the policy
                   internalises round-trip economics: it learns to shade the
                   outbound quote on lanes with high backhaul probability.

Baselines for evaluation:
  StaticCostPlus — always quote market rate (mult = 1.0)
  RuleBased      — +12% when urgent/tight supply, -6% when slack
"""
from __future__ import annotations
import numpy as np

ACTIONS = np.array([0.90, 0.94, 0.98, 1.02, 1.06, 1.12, 1.20])


class LinUCBAgent:
    def __init__(self, n_features: int, alpha: float = 0.6, lam: float = 1.0):
        k = len(ACTIONS)
        self.alpha = alpha
        self.A = np.stack([np.eye(n_features) * lam for _ in range(k)])
        self.b = np.zeros((k, n_features))
        self.A_inv = np.stack([np.eye(n_features) / lam for _ in range(k)])

    def act(self, x: np.ndarray, greedy: bool = False) -> int:
        scores = np.empty(len(ACTIONS))
        for a in range(len(ACTIONS)):
            theta = self.A_inv[a] @ self.b[a]
            mu = float(theta @ x)
            bonus = 0.0 if greedy else self.alpha * np.sqrt(float(x @ self.A_inv[a] @ x))
            scores[a] = mu + bonus
        return int(np.argmax(scores))

    def update(self, x: np.ndarray, a: int, r: float):
        self.A[a] += np.outer(x, x)
        self.b[a] += r * x
        # Sherman–Morrison incremental inverse
        Ax = self.A_inv[a] @ x
        self.A_inv[a] -= np.outer(Ax, Ax) / (1.0 + float(x @ Ax))


class LinearQAgent:
    """Q(s,a) = w_a . phi(s); epsilon-greedy; TD(0) over the 2-step episode."""

    def __init__(self, n_features: int, lr: float = 0.01, gamma: float = 0.95,
                 eps: float = 0.30, eps_min: float = 0.02, eps_decay: float = 0.99996,
                 seed: int = 11):
        self._n_base = n_features
        n_phi = n_features + 5 * n_features + 1   # base + interactions + bias
        self.w = np.zeros((len(ACTIONS), n_phi))
        self.lr, self.gamma = lr, gamma
        self.eps, self.eps_min, self.eps_decay = eps, eps_min, eps_decay
        self.rng = np.random.default_rng(seed)

    @staticmethod
    def _phi(x: np.ndarray) -> np.ndarray:
        # interactions with the elasticity-relevant dims:
        # d/s ratio (4), urgency (8), shipper sensitivity (9), leg (10), rate-cover (11)
        inter = np.concatenate([x * x[i] for i in (4, 8, 9, 10, 11)])
        return np.concatenate([x, inter, [1.0]])

    def q(self, x: np.ndarray) -> np.ndarray:
        return self.w @ self._phi(x)

    def act(self, x: np.ndarray, greedy: bool = False) -> int:
        if not greedy and self.rng.random() < self.eps:
            return int(self.rng.integers(len(ACTIONS)))
        return int(np.argmax(self.q(x)))

    def update(self, x, a, r, x_next, done):
        phi = self._phi(x)
        target = r if done else r + self.gamma * float(np.max(self.q(x_next)))
        td = target - float(self.w[a] @ phi)
        self.w[a] += self.lr * td * phi
        self.eps = max(self.eps_min, self.eps * self.eps_decay)


class StaticCostPlus:
    def act(self, x, greedy=True):
        return int(np.argmin(np.abs(ACTIONS - 1.0)))

    def update(self, *a, **k):
        pass


class RuleBased:
    """Heuristic a human pricing analyst might encode."""

    def act(self, x, greedy=True):
        urgent, ds = x[8] > 0.5, x[4] * 2.6
        if urgent or ds > 1.4:
            return int(np.argmin(np.abs(ACTIONS - 1.12)))
        if ds < 0.8:
            return int(np.argmin(np.abs(ACTIONS - 0.94)))
        return int(np.argmin(np.abs(ACTIONS - 1.02)))

    def update(self, *a, **k):
        pass
