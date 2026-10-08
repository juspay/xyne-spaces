/*----------------------------------------------------------------
 *  Copyright (c) ThoughtWorks, Inc.
 *  Licensed under the Apache License, Version 2.0
 *  See LICENSE in the project root for license information.
 *----------------------------------------------------------------*/
const SORTING_ORDER = {
    DESC: 'DESC',
    ASC: 'ASC',
};

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    var angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;

    return {
        x: centerX + (radius * Math.cos(angleInRadians)),
        y: centerY + (radius * Math.sin(angleInRadians))
    };
}

function describeArc(x, y, radius, startAngle, endAngle) {
    var start = polarToCartesian(x, y, radius, endAngle);
    var end = polarToCartesian(x, y, radius, startAngle);

    var arcSweep = endAngle - startAngle <= 180 ? "0" : "1";

    return [
        "M", start.x, start.y,
        "A", radius, radius, 0, arcSweep, 0, end.x, end.y,
        "L", x, y,
        "L", start.x, start.y, "Z"
    ].join(" ");
}

function filterSpecList(status) {
    $('#listOfSpecifications li.spec-name').each(function () {
        if ($(this).hasClass(status)) {
            $(this).show();
        } else {
            $(this).hide();
        }
    });
    var specs = $(".spec-list a").filter(function () { return $(this).children().first().is(':visible'); })
    filterSidebar(specs, $('#searchSpecifications').val().trim());
}

function updateQueryParamsForSpecsUrl(element) {
    if (!element || isSessionStorageAccessible()) {
        return;
    }
    let url = new URL(element.href);
    url.search = dataStore.isEmpty() ? '' : `?${dataStore}`;
    element.href = url.toString();
}

function showFirstSpecContent() {
    let elem = $('li.spec-name:visible:first');
    updateQueryParamsForSpecsUrl(elem.parent()[0])
    elem.click();
    if ($('li.spec-name:visible:first').length === 0) {
        $('#specificationContainer').hide();
    }
}

function filterSidebar(specsCollection, searchText) {
    if (!index) return;
    tagMatches = index.Tags[searchText];
    specsCollection.each(function () {
        let elem = $(this);
        updateQueryParamsForSpecsUrl(elem[0])
        var relPath = elem.attr('href').split("/");
        var fileName = relPath[relPath.length - 1];
        var existsIn = function (arr) {
            if (arr === undefined) {
                return false;
            }
            arr = $.grep(arr, function (a, i) {
                return a.indexOf(fileName) > -1;
            });
            return arr.length > 0;
        }
        specHeadingText = elem.text().trim().toLowerCase();
        if (existsIn(tagMatches) || specHeadingText.indexOf(searchText.toLowerCase()) > -1 || searchText === '') {
            $(elem.find('li')[0]).show();
        } else {
            $(elem.find('li')[0]).hide();
        }
    })
}

function resetSidebar() {
    $('#listOfSpecifications li.spec-name').each(function () {
        $(this).show();
    });
}

function openModal(e) {
    $(this).next('.modal').css('display', 'block');
    $('body').addClass('is-modal-open');
}

function closeModal() {
    $('.modal').css('display', 'none');
    $('body').removeClass('is-modal-open');
}

function isDescendingOrder(specsSortOrder) {
    return specsSortOrder === SORTING_ORDER.DESC;
}

function createDate(hours, minutes, seconds) {
    var date = new Date();
    date.setHours(hours);
    date.setMinutes(minutes);
    date.setSeconds(seconds);
    return date;
}

function sortSpecsByName(sortingOrder) {
    return $('#listOfSpecifications ul#scenarios a').sort(function (leftSpec, rightSpec) {
        if (isDescendingOrder(sortingOrder))
            return $(leftSpec).find('.spec-name span:nth-child(1)').text() > $(rightSpec).find('.spec-name span:nth-child(1)').text() ? -1 : 1;
        else
            return $(leftSpec).find('.spec-name span:nth-child(1)').text() < $(rightSpec).find('.spec-name span:nth-child(1)').text() ? -1 : 1;
    });
}

function sortSpecsByExecutionTime(sortingOrder) {
    return $('#listOfSpecifications ul#scenarios a').sort(function (leftSpec, rightSpec) {
        var leftSpecTime = $(leftSpec).find('.spec-name span:nth-child(2)').text().split(':');
        var rightSpecTime = $(rightSpec).find('.spec-name span:nth-child(2)').text().split(':');
        var leftDate = createDate.apply(null, leftSpecTime.map(time => parseInt(time)));
        var rightDate = createDate.apply(null, rightSpecTime.map(time => parseInt(time)));

        if (isDescendingOrder(sortingOrder))
            return leftDate > rightDate ? -1 : 1;
        else
            return leftDate < rightDate ? -1 : 1;
    });
}

function toggleSortIcons(element, sortingOrder) {
    $(element).find('.sort-icons .fa').removeClass('active');
    if (isDescendingOrder(sortingOrder))
        $(element).find('.sort-icons .fa-caret-up').addClass('active');
    else
        $(element).find('.sort-icons .fa-caret-down').addClass('active');
}

const DATA_ATTRS = {
    TABLEROW: 'tablerow',
    SCENARIO_ROW_INDEX: 'scenario-row-index',
    ROWINDEX: 'rowindex'
};

const SELECTORS = {
    SCENARIO_CONTAINER: '.scenario-container',
    SCENARIO_HEAD: '.scenario-head .head',
    SCENARIO_DATA_TABLE: '.scenario-data-table',
    ROW_SELECTOR: '.row-selector',
    ERROR_CONTAINER: '.error-container',
    SPEC_DATA_TABLE: '.data-table:not(.scenario-data-table)'
};

class TableSelectionState {
    constructor() {
        this.selectedSpecRow = null;
        this.selectedScenarioRows = {};
        this.initializeFromDOM();
    }

    initializeFromDOM() {
        $(SELECTORS.SPEC_DATA_TABLE + ' .row-selector.selected').each((_, el) => {
            this.selectedSpecRow = $(el).data(DATA_ATTRS.ROWINDEX);
        });

        $(SELECTORS.SCENARIO_DATA_TABLE + ' .row-selector.selected').each((_, el) => {
            var $table = $(el).closest(SELECTORS.SCENARIO_DATA_TABLE);
            var scenarioHeading = this.getScenarioHeadingForTable($table);
            if (scenarioHeading) {
                this.selectedScenarioRows[scenarioHeading] = $(el).data(DATA_ATTRS.SCENARIO_ROW_INDEX);
            }
        });
    }

    getScenarioHeadingForTable($table) {
        var $firstScenario = $table.nextAll(SELECTORS.SCENARIO_CONTAINER).first();
        return $firstScenario.length > 0 ? $firstScenario.find(SELECTORS.SCENARIO_HEAD).text().trim() : null;
    }

    setSpecRow(rowIndex) {
        this.selectedSpecRow = rowIndex;
    }

    setScenarioRow(heading, rowIndex) {
        this.selectedScenarioRows[heading] = rowIndex;
    }

    getTargetSpecRow() {
        return this.selectedSpecRow !== null ? this.selectedSpecRow : 0;
    }

    getTargetScenarioRow(heading) {
        return this.selectedScenarioRows.hasOwnProperty(heading) ? this.selectedScenarioRows[heading] : 0;
    }
}

class ScenarioVisibilityManager {
    constructor(tableState) {
        this.tableState = tableState;
    }

    initialize() {
        this.attachRowSelectionHandlers();
        this.updateVisibility();
    }

    attachRowSelectionHandlers() {
        $(SELECTORS.ROW_SELECTOR).click((e) => {
            var $clickedRow = $(e.currentTarget);
            var $table = $clickedRow.closest('table');
            var isScenarioTable = $table.hasClass('scenario-data-table');
            $table.find(SELECTORS.ROW_SELECTOR).removeClass('selected');
            $clickedRow.addClass('selected');

            if (isScenarioTable) {
                var scenarioRowIndex = $clickedRow.data(DATA_ATTRS.SCENARIO_ROW_INDEX);
                var scenarioHeading = this.tableState.getScenarioHeadingForTable($table);
                if (scenarioHeading) {
                    this.tableState.setScenarioRow(scenarioHeading, scenarioRowIndex);
                }
            } else {
                var specRowIndex = $clickedRow.data(DATA_ATTRS.ROWINDEX);
                this.tableState.setSpecRow(specRowIndex);
            }

            this.updateVisibility();
        });
    }

    updateVisibility() {
        var scenariosWithBothTables = this.detectScenariosWithBothTables();
        this.updateScenarioContainerVisibility(scenariosWithBothTables);
        this.updateScenarioTableVisibility();
        this.updateErrorContainerVisibility();
    }

    detectScenariosWithBothTables() {
        var scenariosWithBothTables = {};
        $(SELECTORS.SCENARIO_CONTAINER).each((_, el) => {
            var $scn = $(el);
            var specRowIdx = $scn.data(DATA_ATTRS.TABLEROW);
            var scenarioRowIdx = $scn.data(DATA_ATTRS.SCENARIO_ROW_INDEX);
            var scenarioHeading = $scn.find(SELECTORS.SCENARIO_HEAD).text().trim();

            if (typeof specRowIdx !== 'undefined' && typeof scenarioRowIdx !== 'undefined' && scenarioHeading) {
                scenariosWithBothTables[scenarioHeading] = true;
            }
        });
        return scenariosWithBothTables;
    }

    updateScenarioContainerVisibility(scenariosWithBothTables) {
        $(SELECTORS.SCENARIO_CONTAINER).each((_, el) => {
            var $scn = $(el);
            var specRowIdx = $scn.data(DATA_ATTRS.TABLEROW);
            var scenarioRowIdx = $scn.data(DATA_ATTRS.SCENARIO_ROW_INDEX);
            var scenarioHeading = $scn.find(SELECTORS.SCENARIO_HEAD).text().trim();
            var isSpecTableDriven = typeof specRowIdx !== 'undefined';
            var isScenarioTableDriven = typeof scenarioRowIdx !== 'undefined';
            var hasBothTables = isSpecTableDriven && isScenarioTableDriven;

            if (scenariosWithBothTables[scenarioHeading] && !hasBothTables) {
                $scn.hide();
                return;
            }

            var showScenario = this.shouldShowScenario(
                isSpecTableDriven,
                isScenarioTableDriven,
                specRowIdx,
                scenarioRowIdx,
                scenarioHeading
            );

            $scn.toggle(showScenario);
        });
    }

    shouldShowScenario(isSpecTableDriven, isScenarioTableDriven, specRowIdx, scenarioRowIdx, scenarioHeading) {
        if (!isSpecTableDriven && !isScenarioTableDriven) {
            return true;
        }

        if (isSpecTableDriven && !isScenarioTableDriven) {
            return specRowIdx === this.tableState.getTargetSpecRow();
        }

        if (!isSpecTableDriven && isScenarioTableDriven) {
            return scenarioRowIdx === this.tableState.getTargetScenarioRow(scenarioHeading);
        }

        return specRowIdx === this.tableState.getTargetSpecRow() &&
            scenarioRowIdx === this.tableState.getTargetScenarioRow(scenarioHeading);
    }

    updateScenarioTableVisibility() {
        var tableInfo = [];
        $(SELECTORS.SCENARIO_DATA_TABLE).each((_, table) => {
            var $table = $(table);
            var scenarioHeading = this.tableState.getScenarioHeadingForTable($table);
            tableInfo.push({ $table: $table, heading: scenarioHeading });
        });
        tableInfo.forEach(info => {
            var $visibleScenario = null;

            if (info.heading) {
                $(SELECTORS.SCENARIO_CONTAINER).each((_, el) => {
                    var $scn = $(el);
                    var heading = $scn.find(SELECTORS.SCENARIO_HEAD).text().trim();
                    if (heading === info.heading && $scn.is(':visible')) {
                        $visibleScenario = $scn;
                        return false;
                    }
                });
            }

            if ($visibleScenario) {
                if (info.$table.next()[0] !== $visibleScenario[0]) {
                    info.$table.insertBefore($visibleScenario);
                }
                info.$table.show();
            } else {
                info.$table.hide();
            }
        });
    }

    updateErrorContainerVisibility() {
        $(SELECTORS.ERROR_CONTAINER).each((_, el) => {
            var $error = $(el);
            var errorTableRowIdx = $error.data(DATA_ATTRS.TABLEROW);

            // If error has no table row association, always show it
            if (typeof errorTableRowIdx === 'undefined') {
                $error.show();
                return;
            }

            // If there's no spec table (selectedSpecRow is null), show all errors
            if (this.tableState.selectedSpecRow === null) {
                $error.show();
                return;
            }

            // Show error only if it matches the selected row
            $error.toggle(errorTableRowIdx === this.tableState.selectedSpecRow);
        });
    }
}

var initializers = {
    "initializeFilters": function () {
        if (dataStore.get('FilterStatus')) {
            filterSpecList(dataStore.get('FilterStatus'));
            $('.spec-filter').each(function () {
                if ($(this).data('status') === dataStore.get('FilterStatus')) {
                    $(this).addClass('active');
                }
            });
            if ($('li.spec-name:visible:first').length === 0) {
                $('#specificationContainer').hide();
            }
        } else {
            $('.total-specs').addClass('active');
        }
        if (dataStore.get('SearchText')) {
            $('#searchSpecifications').val(dataStore.get('SearchText'));
            var specs = $(".spec-list a");
            filterSidebar(specs, dataStore.get('SearchText'));
        }
    },
    "attachScenarioToggle": function () {
        var tableState = new TableSelectionState();
        var scenarioVisibilityManager = new ScenarioVisibilityManager(tableState);
        scenarioVisibilityManager.initialize();
    },
    "attachSpecFilter": function () {
        var resetState = function () {
            $('.spec-filter, .total-specs').each(function () {
                $(this).removeClass('active');
            });
        };
        $('.spec-filter, #pie-chart path.shadow').click(function () {
            resetState();
            var status = $(this).data('status');
            dataStore.insertItem('FilterStatus', status);
            filterSpecList(status);
            showFirstSpecContent();
            $(this).addClass('active');
        });
        $('.total-specs').click(function () {
            resetState();
            resetSidebar();
            dataStore.removeItem('FilterStatus');
            var specs = $(".spec-list a").filter(function () { return $(this).children().first().is(':visible'); })
            filterSidebar(specs, $('#searchSpecifications').val().trim());
            showFirstSpecContent();
            $(this).addClass('active');
        });
    },
    "registerModals": function () {
        $('.modal-link').click(openModal);
        $(document).keydown(function (e) {
            if (e.keyCode == 27) closeModal();
        })
        $('.close').click(closeModal)
    },
    "registerConceptToggle": function () {
        $('.concept').click(function () {
            var conceptSteps = $(this).next('.concept-steps');
            var iconClass = $(conceptSteps).is(':visible') ? "plus" : "minus";
            $(conceptSteps).fadeToggle('fast', 'linear');
            $(this).find("i.fa").removeClass("fa-minus-square").removeClass("fa-plus-square").addClass("fa-" + iconClass + "-square");
        });
    },
    "registerMessageToggle": function () {
        $('.message-container i.fa').click(function () {
            var messages = $(this).next('.messages');
            var iconClass = messages.is(':visible') ? "plus" : "minus";
            messages.fadeToggle('fast', 'linear');
            $(this).removeClass("fa-minus-square").removeClass("fa-plus-square").addClass("fa-" + iconClass + "-square");
        });
    },
    "registerErrorContainerToggle": function () {
        $(".error-container .toggle-show").click(function () {
            var self = $(this);
            self.next('.exception-container').stop().toggleClass('hidden');
            self.text(self.text().indexOf("Show") > 0 ? "[Hide details]" : "[Show details]");
        });
    },
    "registerSearch": function () {
        $('#searchSpecifications').change(function () {
            searchText = $(this).val().trim();
            if (searchText.length == 0) {
                dataStore.removeItem('SearchText');
                resetSidebar();
            } else {
                dataStore.insertItem('SearchText', searchText);
                var specs = $(".spec-list a");
                filterSidebar(specs, searchText);
            }
            showFirstSpecContent();
        });
    },
    "registerSearchAutocomplete": function () {
        new autoComplete({
            selector: 'input[id="searchSpecifications"]',
            minChars: 1,
            source: function (term, suggest) {
                term = term.toLowerCase();
                var tagChoices = Object.keys(index.Tags);
                var specChoices = Object.keys(index.Specs);
                var suggestions = [];
                var suggestionPredicate = function (type) {
                    return function (x) {
                        if (x.toLowerCase().startsWith(term))
                            suggestions.push([x, type]);
                    }
                };
                tagChoices.forEach(suggestionPredicate("tag"));
                specChoices.forEach(suggestionPredicate("spec"));
                suggest(suggestions);
            },
            renderItem: function (item, search) {
                iconClass = item[1] == "tag" ? "tags" : "bars"
                return '<div class="autocomplete-suggestion" data-value="' + item[0] + '"><i class="fa fa-' + iconClass + '" aria-hidden="true"></i>&nbsp;' + item[0] + '</div>';
            },
            onSelect: function (e, term, item) {
                $('#searchSpecifications').val($(item).data('value')).change();
            }
        });
    },
    "initializeClipboard": function () {
        new Clipboard('.clipboard-btn');
    },
    "drawPieChart": function () {
        var results = $("#pie-chart").data("results").split(",").map(Number);
        var total = Number($("#pie-chart").data("total"));
        var paths = $("#pie-chart path.status")
        var startAngle = 0;
        for (i = 0; i < results.length; i++) {
            coveredAngle = startAngle + results[i] * 360 / total;
            if (total === results[i])
                coveredAngle -= 0.05;
            $(paths[i]).attr('d', describeArc(100, 75, 72, startAngle, coveredAngle));
            $(paths[i]).next('path.shadow').attr('d', describeArc(100, 75, 75, startAngle, coveredAngle));
            if (results[i] === 0 || total === results[i])
                $(paths[i]).attr('stroke-width', 0);
            startAngle = coveredAngle;
        }
    },
    "initSpecsSorting": function () {
        $('.specs-sorting .sort').click(function () {
            const sortBy = $(this).data('sort-by');
            var sortingOrder = dataStore.get(sortBy);
            sortingOrder = sortingOrder === SORTING_ORDER.ASC ? SORTING_ORDER.DESC : SORTING_ORDER.ASC;
            dataStore.insertItem(sortBy, sortingOrder);
            var sortingFunc;
            sortingFunc = sortBy === 'specs-name' ? sortSpecsByName : sortSpecsByExecutionTime;
            toggleSortIcons(this, sortingOrder);
            $('#listOfSpecifications ul#scenarios').html(sortingFunc(sortingOrder));
        });
    }
};

function isSessionStorageAccessible() {
    try {
        sessionStorage
    } catch (e) {
        return false;
    }
    return true;
}

class DataStore {
    constructor(data) {
        this.data = data;
    }

    insertItem(key, value) {
        this.data[key.toLowerCase()] = value;
    }

    removeItem(key) {
        delete this.data[key.toLowerCase()]
    }

    get(key) {
        return this.data[key.toLowerCase()];
    }

    isEmpty() {
        return $.isEmptyObject(this.data);
    }

    toString() {
        return JSON.stringify(this.data);
    }
}
$(function () {
    let data = {};
    if (isSessionStorageAccessible()) {
        data = sessionStorage;
    } else if (window.location.search) {
        data = JSON.parse(decodeURI(window.location.search.slice(1)));
    }
    dataStore = new DataStore(data)
    $.each(initializers, function (k, v) { v(); });
});

// Multiline section toggle functionality
function initMultilineSections() {
    const multilineHeaders = document.querySelectorAll('.multiline-header');

    multilineHeaders.forEach(header => {
        header.addEventListener('click', function () {
            const content = this.parentElement.querySelector('.multiline-content');
            const icon = this.querySelector('.fa');
            const isExpanded = content.classList.contains('expanded');

            // Toggle content
            content.classList.toggle('expanded', !isExpanded);

            // Toggle icon between plus and minus
            if (isExpanded) {
                icon.classList.remove('fa-minus-square');
                icon.classList.add('fa-plus-square');
            } else {
                icon.classList.remove('fa-plus-square');
                icon.classList.add('fa-minus-square');
            }
        });
    });
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', function () {
    initMultilineSections();
});

// Re-initialize when spec content is loaded (Gauge uses this event)
$(document).on('specContentLoaded', function () {
    initMultilineSections();
});