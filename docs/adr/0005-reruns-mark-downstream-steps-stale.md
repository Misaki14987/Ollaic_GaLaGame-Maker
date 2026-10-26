# Reruns Mark Downstream Steps Stale

When a Flow Step is rerun, completed downstream Steps that depend on its previous output become stale instead of being silently rerun or left as current. This keeps FlowBoard honest about which outputs match the latest upstream inputs while letting users decide when to spend time and model cost rerunning downstream work; Run to Playable may automatically continue through stale downstream Steps.
