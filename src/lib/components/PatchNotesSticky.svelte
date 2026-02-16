<script lang="ts">
	interface PatchNoteSection {
		title: string;
		items: string[];
	}

	interface Props {
		version: string;
		releaseLabel?: string;
		sections: PatchNoteSection[];
		onClose?: () => void;
	}

	let { version, releaseLabel = 'Patch Notes', sections, onClose }: Props = $props();
</script>

<div class="sticky-wrapper" role="dialog" aria-label={`Billi ${version} patch notes`}>
	<button class="close-btn" onclick={() => onClose?.()} aria-label="Close patch notes">
		×
	</button>

	<div class="sticky-corner" aria-hidden="true"></div>

	<div class="sticky-content">
		<p class="sticky-kicker">{releaseLabel}</p>
		<h2 class="sticky-title">Billi {version}</h2>

		{#each sections as section}
			<section class="sticky-section">
				<h3>{section.title}</h3>
				<ul>
					{#each section.items as item}
						<li>{item}</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>

<style>
	.sticky-wrapper {
		position: relative;
		width: min(560px, 92vw);
		background: #fdf08a;
		color: #3f2a08;
		border-radius: 10px 10px 6px 10px;
		box-shadow:
			0 20px 30px rgba(0, 0, 0, 0.3),
			0 0 0 1px rgba(120, 53, 15, 0.14) inset;
		transform: rotate(-0.55deg);
	}

	.sticky-wrapper::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.2), transparent 28%),
			repeating-linear-gradient(
				0deg,
				transparent 0 26px,
				rgba(120, 53, 15, 0.1) 26px 27px
			);
		pointer-events: none;
	}

	.sticky-corner {
		position: absolute;
		top: 0;
		right: 0;
		width: 34px;
		height: 34px;
		background: linear-gradient(135deg, rgba(120, 53, 15, 0.18), rgba(120, 53, 15, 0.03));
		clip-path: polygon(100% 0, 0 0, 100% 100%);
		border-top-right-radius: 10px;
	}

	.sticky-content {
		position: relative;
		padding: 1rem 1.1rem 1.1rem;
		font-family:
			'Caveat',
			'Patrick Hand',
			'Bradley Hand',
			'Comic Sans MS',
			cursive;
		line-height: 1.35;
		max-height: min(72vh, 620px);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.sticky-kicker {
		margin: 0;
		font-size: 0.9rem;
		letter-spacing: 0.04em;
		opacity: 0.8;
		text-transform: uppercase;
	}

	.sticky-title {
		margin: 0.15rem 0 0.6rem;
		font-size: 1.95rem;
		line-height: 1;
	}

	.sticky-section + .sticky-section {
		margin-top: 0.55rem;
	}

	.sticky-section h3 {
		margin: 0 0 0.1rem;
		font-size: 1.25rem;
		text-decoration: underline;
		text-decoration-thickness: 1.5px;
		text-underline-offset: 2px;
	}

	.sticky-section ul {
		margin: 0;
		padding-left: 1.05rem;
	}

	.sticky-section li {
		margin: 0.06rem 0;
		font-size: 1.17rem;
	}

	.close-btn {
		position: absolute;
		top: 0.35rem;
		right: 0.55rem;
		border: none;
		background: transparent;
		color: #713f12;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0.8;
		z-index: 2;
	}

	.close-btn:hover {
		opacity: 1;
	}

	.sticky-content::-webkit-scrollbar {
		width: 8px;
	}

	.sticky-content::-webkit-scrollbar-track {
		background: rgba(120, 53, 15, 0.08);
		border-radius: 999px;
	}

	.sticky-content::-webkit-scrollbar-thumb {
		background: rgba(120, 53, 15, 0.35);
		border-radius: 999px;
	}

	.sticky-content::-webkit-scrollbar-thumb:hover {
		background: rgba(120, 53, 15, 0.45);
	}
</style>
