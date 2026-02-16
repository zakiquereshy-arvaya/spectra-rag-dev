<script lang="ts">
	let { data, form } = $props();
</script>

<div class="min-h-screen px-6 py-10">
	<div class="max-w-3xl mx-auto space-y-8">
		<header class="glass rounded-2xl px-6 py-5">
			<h1 class="text-2xl font-semibold text-white">Action Items Approval</h1>
			<p class="text-sm text-slate-400 mt-1">
				Review each item and confirm approval or rejection before continuing the workflow.
			</p>
		</header>

		{#if !data.workflowExecutionId}
			<div class="glass rounded-2xl px-6 py-5 text-slate-300">
				<p class="text-sm">
					No approval request found. Make sure the approval URL includes a
					<code class="text-slate-200">workflow_execution_id</code>.
				</p>
			</div>
		{:else if data.notFound}
			<div class="glass rounded-2xl px-6 py-5 text-slate-300">
				<p class="text-sm">
					This approval request is missing or has expired. Please re-send the action items.
				</p>
			</div>
		{:else}
			{#if data.submitted}
				<div class="glass rounded-2xl px-6 py-5 text-green-300">
					<p class="text-sm">Thanks! Your approval decisions have been submitted.</p>
				</div>
			{/if}

			{#if form?.error}
				<div class="glass rounded-2xl px-6 py-5 text-red-300">
					<p class="text-sm">{form.error}</p>
				</div>
			{/if}

			{#if data.goal}
				<div class="glass rounded-2xl px-6 py-5">
					<h2 class="text-sm uppercase tracking-wide text-slate-400">Goal</h2>
					<p class="text-base text-white mt-2">{data.goal}</p>
				</div>
			{/if}

			<form method="POST" class="space-y-4">
				<input type="hidden" name="workflow_execution_id" value={data.workflowExecutionId} />

				<div class="space-y-4">
					{#each data.actionItems as item, index}
						<div class="glass rounded-2xl px-6 py-5 space-y-4">
							<div>
								<h3 class="text-lg font-medium text-white">{item.title}</h3>
								{#if item.owner}
									<p class="text-sm text-slate-400 mt-1">Owner: {item.owner}</p>
								{/if}
								{#if item.goal}
									<p class="text-sm text-slate-400 mt-1">Goal: {item.goal}</p>
								{/if}
							</div>

							<div class="flex flex-wrap gap-4 text-sm">
								<label class="flex items-center gap-2 text-slate-200">
									<input
										type="radio"
										name={`status-${index}`}
										value="approved"
										checked
										class="accent-emerald-500"
									/>
									Approve
								</label>
								<label class="flex items-center gap-2 text-slate-200">
									<input
										type="radio"
										name={`status-${index}`}
										value="rejected"
										class="accent-rose-500"
									/>
									Reject
								</label>
							</div>
						</div>
					{/each}
				</div>

				<button
					type="submit"
					class="w-full py-3 bg-linear-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium
					       hover:from-indigo-400 hover:to-purple-500 focus:outline-none focus:ring-2
					       focus:ring-indigo-500/50 transition-all shadow-lg shadow-indigo-500/20 btn-press"
				>
					Submit Decisions
				</button>
			</form>
		{/if}
	</div>
</div>
