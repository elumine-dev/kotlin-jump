import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';

const VIEW_MODEL = `package com.example.app

@Suppress("TooManyFunctions")
class AppViewModel @Inject constructor(
    private val userRepository: UserRepository,
    private val analyticsService: AnalyticsService,
    private val settingsManager: SettingsManager,
) : ViewModel() {

    private val _state: MutableStateFlow<State> = MutableStateFlow(State.initial)
    val state = _state.asStateFlow()

    private val _events = MutableSharedFlow<NavEvent>(extraBufferCapacity = 1)
    internal val events: SharedFlow<NavEvent> = _events.asSharedFlow()

    private var refreshJob: Job? = null

    private val _viewMode: MutableStateFlow<ViewMode> = MutableStateFlow(ViewMode.List())
    val viewMode = _viewMode.asStateFlow()

    init {
        loadData()
        observeNetwork()
    }

    override fun onCleared() {
        super.onCleared()
    }

    private fun observeNetwork() {
        viewModelScope.launch {}
    }

    @Subscribe
    fun onDataChanged(event: DataChangedEvent) {
    }

    fun loadData() {
        val items = userRepository.run {
            getAll().map { it }
        }
    }

    fun updateViewMode(newMode: ViewMode) {
        _viewMode.value = newMode
    }

    fun resetPositions() {
    }

    fun onItemClicked(index: Int) {
        val current = _viewMode.value
        val isExpanded = current is ViewMode.Expanded
        val focusedSection = current.focusedSection
    }

    fun onScroll(newIndex: Int) {
    }

    private fun createExpandedMode(
        index: Int,
        section: SectionType,
        current: ViewMode
    ): ViewMode.Expanded {
        return ViewMode.Expanded()
    }

    private fun getPosition(section: SectionType, mode: ViewMode): Int? {
        return null
    }

    fun navigateTo(item: Item, resume: Boolean = false) {
    }

    private suspend fun waitForReady(
        itemId: String,
        onReady: (suspend () -> Unit)? = null,
    ) {
    }

    fun cancelPending() {
    }

    fun onDeleted() {
    }

    fun navigateToSettings() {
    }

    data class State(
        val items: List<Item>,
        val specialItems: List<Item>,
        val today: String,
    ) {
        companion object {
            val initial = State(
                items = emptyList(),
                specialItems = emptyList(),
                today = "",
            )
        }
    }

    companion object {
        private const val REFRESH_DELAY_MS = 1000L
        private const val CHECK_INTERVAL_MS = 1000L
        private const val TIMEOUT_MS = 60_000L
    }
}
`;

function find(name: string) {
  return parse('file:///AppViewModel.kt', VIEW_MODEL).symbols.find(s => s.name === name);
}

describe('ViewModel — class and supertypes', () => {
  it('class is indexed', () => {
    expect(find('AppViewModel')?.kind).toBe('class');
  });

  it('has ViewModel as supertype (multi-line @Inject constructor)', () => {
    expect(find('AppViewModel')?.supertypes).toContain('ViewModel');
  });

  it('constructor params are NOT indexed', () => {
    expect(find('userRepository')).toBeUndefined();
    expect(find('analyticsService')).toBeUndefined();
    expect(find('settingsManager')).toBeUndefined();
  });
});

describe('ViewModel — properties', () => {
  it('private val _state', () => {
    expect(find('_state')?.kind).toBe('val');
  });

  it('val state', () => {
    expect(find('state')?.kind).toBe('val');
  });

  it('private val _events', () => {
    expect(find('_events')).toBeDefined();
  });

  it('internal val events', () => {
    expect(find('events')).toBeDefined();
  });

  it('private var refreshJob', () => {
    expect(find('refreshJob')?.kind).toBe('var');
  });

  it('private val _viewMode', () => {
    expect(find('_viewMode')).toBeDefined();
  });

  it('val viewMode', () => {
    expect(find('viewMode')).toBeDefined();
  });
});

describe('ViewModel — functions', () => {
  it('override fun onCleared', () => {
    expect(find('onCleared')?.kind).toBe('fun');
  });

  it('private fun observeNetwork', () => {
    expect(find('observeNetwork')?.kind).toBe('fun');
  });

  it('@Subscribe fun onDataChanged', () => {
    expect(find('onDataChanged')?.kind).toBe('fun');
  });

  it('fun loadData', () => {
    expect(find('loadData')?.kind).toBe('fun');
  });

  it('fun updateViewMode', () => {
    expect(find('updateViewMode')?.kind).toBe('fun');
  });

  it('fun resetPositions', () => {
    expect(find('resetPositions')?.kind).toBe('fun');
  });

  it('fun onItemClicked', () => {
    expect(find('onItemClicked')?.kind).toBe('fun');
  });

  it('fun onScroll', () => {
    expect(find('onScroll')?.kind).toBe('fun');
  });

  it('private fun createExpandedMode', () => {
    expect(find('createExpandedMode')?.kind).toBe('fun');
  });

  it('private fun getPosition', () => {
    expect(find('getPosition')?.kind).toBe('fun');
  });

  it('fun navigateTo with default param', () => {
    expect(find('navigateTo')?.kind).toBe('fun');
  });

  it('private suspend fun waitForReady', () => {
    expect(find('waitForReady')?.kind).toBe('fun');
  });

  it('fun cancelPending', () => {
    expect(find('cancelPending')?.kind).toBe('fun');
  });

  it('fun onDeleted', () => {
    expect(find('onDeleted')?.kind).toBe('fun');
  });

  it('fun navigateToSettings', () => {
    expect(find('navigateToSettings')?.kind).toBe('fun');
  });
});

describe('ViewModel — nested data class', () => {
  it('data class State is indexed', () => {
    expect(find('State')?.kind).toBe('dataClass');
  });

  it('State is nested (depth > 0)', () => {
    expect(find('State')!.depth).toBeGreaterThan(0);
  });

  it('companion val initial', () => {
    expect(find('initial')?.kind).toBe('val');
  });
});

describe('ViewModel — companion object constants', () => {
  it('REFRESH_DELAY_MS', () => {
    expect(find('REFRESH_DELAY_MS')?.kind).toBe('val');
  });

  it('CHECK_INTERVAL_MS', () => {
    expect(find('CHECK_INTERVAL_MS')?.kind).toBe('val');
  });

  it('TIMEOUT_MS', () => {
    expect(find('TIMEOUT_MS')?.kind).toBe('val');
  });
});

describe('ViewModel — local variables', () => {
  it('val items inside loadData', () => {
    expect(find('items')).toBeDefined();
  });

  it('val current inside onItemClicked', () => {
    expect(find('current')).toBeDefined();
  });

  it('val isExpanded inside onItemClicked', () => {
    expect(find('isExpanded')).toBeDefined();
  });

  it('val focusedSection inside onItemClicked', () => {
    expect(find('focusedSection')).toBeDefined();
  });
});

describe('ViewModel — package', () => {
  it('extracts package name', () => {
    expect(parse('file:///test.kt', VIEW_MODEL).packageName).toBe('com.example.app');
  });
});
