/*!
 * SAP UI development toolkit for HTML5 (SAPUI5/OpenUI5)
 * (c) Copyright 2009-2014 SAP SE or an SAP affiliate company. 
 * Licensed under the Apache License, Version 2.0 - see LICENSE.txt.
 */

// Provides class sap.ui.model.odata.ODataListBinding
sap.ui.define(['jquery.sap.global', 'sap/ui/model/TreeBinding', 'sap/ui/model/ChangeReason', 'sap/ui/model/Sorter', 'sap/ui/model/FilterOperator', './odata4analytics'],
	function(jQuery, TreeBinding, ChangeReason, Sorter, FilterOperator, odata4analytics) {
	"use strict";
	
	/**
	 * @class 
	 * Tree binding implementation for client models
	 *
	 * @param {sap.ui.model.Model} oModel
	 * @param {string} sPath the path pointing to the tree / array that should be bound
	 * @param {object} [oContext=null] the context object for this databinding (optional)
	 * @param {array} [aFilters=null] predefined filter/s contained in an array (optional)
	 * @param {object} [mParameters=null] additional model specific parameters (optional) 
	 * 
	 * @name sap.ui.model.analytics.AnalyticalBinding
	 * @extends sap.ui.model.TreeBinding
	 * @experimental This module is only for experimental use!
	 * @protected
	 */
	var AnalyticalBinding = TreeBinding.extend("sap.ui.model.analytics.AnalyticalBinding", /** @lends sap.ui.model.analytics.AnalyticalBinding.prototype */ {

			constructor : function(oModel, sPath, oContext, aSorter, aFilters, mParameters) {
				TreeBinding.call(this, oModel, sPath, oContext, aFilters, mParameters);

				// attribute members for addressing the requested entity set
				this.sEntitySetName = (mParameters && mParameters.entitySet) ? mParameters.entitySet : undefined; 
				// attribute members for maintaining aggregated OData requests
				this.bArtificalRootContext = false;
				this.aApplicationFilter = this._convertDeprecatedFilterObjects(aFilters);
				this.aControlFilter = undefined;
				this.aSorter = aSorter ? aSorter : [];
				this.aMaxAggregationLevel = [];
				this.aAggregationLevel = [];
				this.oPendingRequests = {};
				this.oPendingRequestHandle = [];
				this.oGroupedRequests = {};
				this.bUseBatchRequests = (mParameters && mParameters.useBatchRequests === true) ? true : false;
				this.bProvideTotalSize = (mParameters && mParameters.provideTotalResultSize === false) ? false : true;
				this.bProvideGrandTotals = (mParameters && mParameters.provideGrandTotals === false) ? false : true;
				this.bUseAcceleratedAutoExpand = true; // TODO verify simple auto expand method // (mParameters && mParameters.useAcceleratedAutoExpand === true) ? true : false;
				this.aRequestQueue = [];

				// attribute members for maintaining loaded data; mapping from groupId to related information
				this.iTotalSize = -1;
				this.mKey = {}; // keys of loaded entities belonging to group with given ID
				this.mFinalLength = {}; // true iff all entities of group with given ID have been loaded (keys in mKey) 
				this.mLength = {}; // number of currently loaded entities 
				this.bNeedsUpdate = false;
				this.mOwnKey = {}; // entity keys of loaded group Id's 
				// attribute members for maintaining structure details requested by the binding consumer
				this.oAnalyticalQueryResult = this.oModel.getAnalyticalExtensions().findQueryResultByName(this._getEntitySet());
				this.aAnalyticalInfo = [];
				this.mAnalyticalInfoByProperty = {};

				this.updateAnalyticalInfo(mParameters == undefined ? [] : mParameters.analyticalInfo);
			}

		});

	/* *******************************
	 *** Public methods
	 ********************************/

	// called for initial population and on every subsequent change of grouping structure or filter conditions
	AnalyticalBinding.prototype.getRootContexts = function(mParameters) {
		var iAutoExpandGroupsToLevel = (mParameters && mParameters.numberOfExpandedLevels ? mParameters.numberOfExpandedLevels + 1 : 1);
// 		this._trace_enter("API", "getRootContexts", "", mParameters, ["numberOfExpandedLevels", "startIndex","length","threshold"]); // DISABLED FOR PRODUCTION 
		var aRootContext = null;
		
		var sRootContextGroupMembersRequestId = this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: null});
		
		// if the root context is artificial (i.e. no grand total requested), then delay its return until all other related requests have been completed
		if (this.bArtificalRootContext 
				&& !this._cleanupGroupingForCompletedRequest(sRootContextGroupMembersRequestId)) {
// 			this._trace_leave("API", "getRootContexts", "delay until related requests have been completed"); // DISABLED FOR PRODUCTION 			
			return null;
		}
		
		if (iAutoExpandGroupsToLevel <= 1) {
			aRootContext = this._getContextsForParentContext(null);
			if (iAutoExpandGroupsToLevel == 1) {
				this._considerRequestGrouping([ sRootContextGroupMembersRequestId, 
				                                this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: "/"}) ]);
				this.getNodeContexts(this.getModel().getContext("/"), {
					startIndex : mParameters.startIndex,
					length : mParameters.length,
					threshold : mParameters.threshold,
					level : 0,
					numberOfExpandedLevels : 0
				});
			}
		}
		else {
			aRootContext = this._getContextsForParentContext(null);
			var aRequestId = this._prepareGroupMembersAutoExpansionRequestIds("/", mParameters.numberOfExpandedLevels);
			aRequestId.push(sRootContextGroupMembersRequestId);
			this._considerRequestGrouping(aRequestId);
			this.getNodeContexts(this.getModel().getContext("/"), {
				startIndex : mParameters.startIndex,
				length : mParameters.length,
				threshold : mParameters.threshold,
				level : 0,
				numberOfExpandedLevels : mParameters.numberOfExpandedLevels
			});
/*			jQuery.sap.log.fatal("not yet implemented: number of initially expanded levels may be 0 or 1, but not "
					+ mParameters.numberOfExpandedLevels);
*/								
		}
		if (aRootContext.length > 1)
			jQuery.sap.log.fatal("assertion failed: grand total represented by a single entry");
// 		this._trace_leave("API", "getRootContexts", "", aRootContext, ["length"]); // DISABLED FOR PRODUCTION 
		return aRootContext;
	};
	
	AnalyticalBinding.prototype.getNodeContexts = function(oContext, mParameters) {
// 		this._trace_enter("API", "getNodeContexts", "groupId=" + this._getGroupIdFromContext(oContext, mParameters.level), mParameters,["startIndex","length","threshold"]); // DISABLED FOR PRODUCTION 
		var iStartIndex, iLength, iThreshold, iLevel, iNumberOfExpandedLevels;
		if (typeof mParameters == "object") {
			iStartIndex = mParameters.startIndex;
			iLength = mParameters.length;
			iThreshold = mParameters.threshold;
			iLevel = mParameters.level;
			iNumberOfExpandedLevels = mParameters.numberOfExpandedLevels;
		} else { // due to compatibility; can be removed if table is adapted
			iStartIndex = arguments[1];
			iLength = arguments[2];
			iThreshold = arguments[3];
			iLevel = arguments[4];
			iNumberOfExpandedLevels = arguments[5];
		}
	
		var aContext = this._getContextsForParentContext(oContext, iStartIndex, iLength, iThreshold, iLevel, iNumberOfExpandedLevels);
// 		this._trace_leave("API", "getNodeContexts", "", aContext, ["length"]); // DISABLED FOR PRODUCTION 
		return aContext;
	};
	
	AnalyticalBinding.prototype.ContextsAvailabilityStatus = { ALL: 2, SOME: 1, NONE: 0 };
	AnalyticalBinding.prototype.hasAvailableNodeContexts = function(oContext, iLevel) {
		var sGroupId = this._getGroupIdFromContext(oContext, iLevel);
		if (this.mKey[sGroupId] != undefined)
			if (this.mFinalLength[sGroupId] == true) 
				return AnalyticalBinding.prototype.ContextsAvailabilityStatus.ALL;
			else
				return AnalyticalBinding.prototype.ContextsAvailabilityStatus.SOME;
		else
			return AnalyticalBinding.prototype.ContextsAvailabilityStatus.NONE;
	};
	
	AnalyticalBinding.prototype.getGroupSize = function(oContext, iLevel) {
		if (oContext === undefined) return 0; // API robustness
		var sGroupId = this._getGroupIdFromContext(oContext, iLevel);
	
		return this.mFinalLength[sGroupId] ? this.mLength[sGroupId] : -1;
	};
	
	AnalyticalBinding.prototype.getTotalSize = function() {
		if (! this.bProvideTotalSize)
			jQuery.sap.log.fatal("total size of result explicitly turned off, but getter invoked");
		return this.iTotalSize;
	};
	
	AnalyticalBinding.prototype.hasChildren = function(oContext, mParameters) {
	
		if (oContext === undefined) return false; // API robustness
		if (oContext == null) return true;
		var iContextLevel = mParameters.level;
		if (iContextLevel == 0) return true;
	
		if (this.aAggregationLevel.length < iContextLevel) return false;
		// children exist if it is not the rightmost grouped column or there is at least one further level with an ungrouped groupable columns.
		return this.aMaxAggregationLevel.indexOf(this.aAggregationLevel[iContextLevel - 1]) < this.aMaxAggregationLevel.length - 1;
	};
	
	AnalyticalBinding.prototype.hasMeasures = function() {
		var bHasMeasures = false;
		for(var p in this.oMeasureDetailsSet) {
			bHasMeasures = true;
			break;
		}
		return bHasMeasures;
	};
	
	AnalyticalBinding.prototype.getDimensionDetails = function() {
		return this.oDimensionDetailsSet;
	};

	AnalyticalBinding.prototype.getMeasureDetails = function() {
		return this.oMeasureDetailsSet;
	};
		
	AnalyticalBinding.prototype.hasGrandTotalDisplayed = function() {
		return this.bProvideGrandTotals;
	};
	
	/**
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.getProperty
	 * @param {string} sPropertyName
	 * @returns {string} The property.
	 */
	AnalyticalBinding.prototype.getProperty = function(sPropertyName) {
		return this.oAnalyticalQueryResult.getEntityType().findPropertyByName(sPropertyName);
	};
	
	/**
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.getFilterablePropertyNames
	 * @returns {Array} The names of the filterable properties in the given entity set.
	 */
	AnalyticalBinding.prototype.getFilterablePropertyNames = function() {
		return this.oAnalyticalQueryResult.getEntityType().getFilterablePropertyNames();
	};
	
	/**
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.getSortablePropertyNames
	 * @returns {Array} The names of the sortable properties in the given entity set.
	 */
	AnalyticalBinding.prototype.getSortablePropertyNames = function() {
		return this.oAnalyticalQueryResult.getEntityType().getSortablePropertyNames();
	};
	
	/**
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.getPropertyLabel
	 * @param {string} sPropertyName
	 * @returns {string} The label maintained for the given property.
	 */
	AnalyticalBinding.prototype.getPropertyLabel = function(sPropertyName) {
		return this.oAnalyticalQueryResult.getEntityType().getLabelOfProperty(sPropertyName);
	};
	
	/**
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.getPropertyHeading
	 * @param {string} sPropertyName
	 * @returns {string} The heading maintained for the given property.
	 */
	AnalyticalBinding.prototype.getPropertyHeading = function(sPropertyName) {
		return this.oAnalyticalQueryResult.getEntityType().getHeadingOfProperty(sPropertyName);
	};
	
	/**
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.getPropertyQuickInfo
	 * @param {string} sPropertyName
	 * @returns {string} The quick info maintained for the given property.
	 */
	AnalyticalBinding.prototype.getPropertyQuickInfo = function(sPropertyName) {
		return this.oAnalyticalQueryResult.getEntityType().getQuickInfoOfProperty(sPropertyName);
	};
	
	/**
	 * @protected
	 * @function
	 * @name AnalyticalBinding.prototype.isMeasure
	 * @param {string} sPropertyName
	 * @returns {boolean} true, if the given property is a measure
	 */
	AnalyticalBinding.prototype.isMeasure = function(sPropertyName) {
		return jQuery.inArray(sPropertyName, this.aMeasureName) !== -1;
	};
	
	/**
	 * Filters the tree according to the filter definitions.
	 * 
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.filter
	 * @param {sap.ui.model.Filter[]}
	 *            aFilter Array of sap.ui.model.Filter objects
	 * @param {sap.ui.model.FilterType} sFilterType Type of the filter which should be adjusted, if it is not given, the standard behaviour applies
	 * @return {sap.ui.model.ListBinding} returns <code>this</code> to facilitate method chaining
	 */
	AnalyticalBinding.prototype.filter = function(aFilter, sFilterType) {
		aFilter = this._convertDeprecatedFilterObjects(aFilter);
		
		if (sFilterType == sap.ui.model.FilterType.Application) this.aApplicationFilter = aFilter;
		else this.aControlFilter = aFilter;

		this.iTotalSize = -1; // invalidate last row counter

		this._abortAllPendingRequests();
				
		this.resetData();
		this._fireRefresh({
			reason : ChangeReason.Filter
		});		
		
		return this;
	};
	
	/**
	 * Sorts the tree.
	 * 
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.sort
	 * @param {sap.ui.model.Sorter|sap.ui.model.Sorter[]}
	 *            aSorter the Sorter or an array of sorter objects object which define the sort order
	 * @return {sap.ui.model.ListBinding} returns <code>this</code> to facilitate method chaining
	 */
	AnalyticalBinding.prototype.sort = function(aSorter) {
	
		if (aSorter instanceof Sorter) {
			aSorter = [ aSorter ];
		}
	
		this.aSorter = aSorter ? aSorter : [];

		this._abortAllPendingRequests();
		
		this._fireRefresh({
			reason : ChangeReason.Sort
		});

		return this;
	};
	
	AnalyticalBinding.prototype.getGroupName = function(oContext, iLevel) {
		if (oContext === undefined) return ""; // API robustness
	
		var sGroupProperty = this.aAggregationLevel[iLevel - 1],
			oDimension = this.oAnalyticalQueryResult.findDimensionByPropertyName(sGroupProperty),
			fValueFormatter = this.mAnalyticalInfoByProperty[sGroupProperty].formatter,
			sPropertyValue = oContext.getProperty(sGroupProperty),
			oTextProperty, sFormattedPropertyValue, sGroupName;
		
		if (oDimension && this.oDimensionDetailsSet[sGroupProperty].textPropertyName) {
			oTextProperty = oDimension.getTextProperty();
		}

		var sTextProperty, sTextPropertyValue, fTextValueFormatter, sTextPropertyValue;
		if (oTextProperty) {
			sTextProperty = oDimension.getTextProperty().name;
			fTextValueFormatter = this.mAnalyticalInfoByProperty[sTextProperty].formatter;
			sTextPropertyValue = oContext.getProperty(sTextProperty);
		}

		if (! oTextProperty) {		
			sFormattedPropertyValue = fValueFormatter ? fValueFormatter(sPropertyValue) : sPropertyValue;
			sGroupName = ((oDimension.getLabelText()) ? oDimension.getLabelText() + ': ' : '') + sFormattedPropertyValue;
		}
		else {
			sFormattedPropertyValue = fValueFormatter ? fValueFormatter(sPropertyValue, sTextPropertyValue) : sPropertyValue;
			sGroupName = ((oDimension.getLabelText()) ? oDimension.getLabelText() + ': ' : '') + sFormattedPropertyValue;
			
			var sFormattedTextPropertyValue = fTextValueFormatter ? fTextValueFormatter(sTextPropertyValue, sPropertyValue) : sTextPropertyValue;
			if (sFormattedTextPropertyValue) {
				sGroupName += ' - ' + sFormattedTextPropertyValue;
			}
		}

		return sGroupName;
	};
	
	AnalyticalBinding.prototype.updateAnalyticalInfo = function(aColumns) {
		// parameter is an array with elements whose structure is defined by sap.ui.analytics.model.AnalyticalTable.prototype._getColumnInformation()
		var oPreviousDimensionDetailsSet = this.oDimensionDetailsSet;
		this.mAnalyticalInfoByProperty = new Object(); // enable associative access to analytical update information
		this.aMaxAggregationLevel = new Array(); // names of all dimensions referenced by any column
		this.aAggregationLevel = new Array(); // names of all currently grouped dimensions
		this.aMeasureName = new Array(); // names of all measures referenced by any column
		this.iAnalyticalInfoVersionNumber = (this.iAnalyticalInfoVersionNumber === undefined ? 1
				: (this.iAnalyticalInfoVersionNumber > 999 ? 1 : this.iAnalyticalInfoVersionNumber + 1));

		this.oMeasureDetailsSet = new Object(); // properties with structure {rawValueProperty,unitProperty,formattedValueProperty}
		this.oDimensionDetailsSet = new Object(); // properties with structure {name,keyProperty,textProperty,aAttributeName}
	
		// process column settings for dimensions and measures part of the result or visible
		for (var i = 0; i < aColumns.length; i++) {
			// determine requested aggregation level from columns representing dimension-related properties
			var oDimension = this.oAnalyticalQueryResult.findDimensionByPropertyName(aColumns[i].name);
			if (oDimension && (aColumns[i].inResult == true || aColumns[i].visible == true)) {
				aColumns[i].dimensionPropertyName = oDimension.getName();
				var oDimensionDetails = this.oDimensionDetailsSet[oDimension.getName()];
				if (!oDimensionDetails) {
					oDimensionDetails = new Object();
					oDimensionDetails.name = oDimension.getName();
					oDimensionDetails.aAttributeName = new Array();
					oDimensionDetails.grouped = false;
					this.oDimensionDetailsSet[oDimension.getName()] = oDimensionDetails;
					this.aMaxAggregationLevel.push(oDimensionDetails.name);
					if (aColumns[i].grouped == true) this.aAggregationLevel.push(oDimensionDetails.name);
				}
				if (aColumns[i].grouped == true) {
					if (this.getSortablePropertyNames().indexOf(oDimension.getName()) == -1) {
						jQuery.sap.log.fatal("property " + oDimension.getName() + " must be sortable in order to be used as grouped dimension");
					}
					oDimensionDetails.grouped = true;
				}
				
				if (oDimension.getName() == aColumns[i].name) {
					oDimensionDetails.keyPropertyName = aColumns[i].name;
				}
				var oTextProperty = oDimension.getTextProperty();
				if (oTextProperty && oTextProperty.name == aColumns[i].name) {
					oDimensionDetails.textPropertyName = aColumns[i].name;
				}
				if (oDimension.findAttributeByName(aColumns[i].name)) {
					oDimensionDetails.aAttributeName.push(aColumns[i].name);
				}
				oDimensionDetails.analyticalInfo = aColumns[i];
			}
	
			// determine necessary measure details from columns visualizing measure-related properties
			var oMeasure = this.oAnalyticalQueryResult.findMeasureByPropertyName(aColumns[i].name);
			if (oMeasure && (aColumns[i].inResult == true || aColumns[i].visible == true)) {
				aColumns[i].measurePropertyName = oMeasure.getName();
				var oMeasureDetails = this.oMeasureDetailsSet[oMeasure.getName()];
				if (!oMeasureDetails) {
					oMeasureDetails = new Object();
					oMeasureDetails.name = oMeasure.getName();
					this.oMeasureDetailsSet[oMeasure.getName()] = oMeasureDetails;
					this.aMeasureName.push(oMeasureDetails.name);
				}
				if (oMeasure.getRawValueProperty().name == aColumns[i].name) {
					oMeasureDetails.rawValuePropertyName = aColumns[i].name;
				}
				var oFormattedValueProperty = oMeasure.getFormattedValueProperty();
				if (oFormattedValueProperty && oFormattedValueProperty.name == aColumns[i].name) {
					oMeasureDetails.formattedValuePropertyName = aColumns[i].name;
				}
				oMeasureDetails.analyticalInfo = aColumns[i];
			}
			this.mAnalyticalInfoByProperty[aColumns[i].name] = aColumns[i];
		}
		// finalize measure information with unit properties also being part of the table
		var oMeasureDetails;
		for ( var measureName in this.oMeasureDetailsSet) {
			var oUnitProperty = this.oAnalyticalQueryResult.findMeasureByName(measureName).getUnitProperty();
			if (oUnitProperty)
				this.oMeasureDetailsSet[measureName].unitPropertyName = oUnitProperty.name;
		}

		// check if any dimension has been added or removed. If so, invalidate the total size
		var compileDimensionNames = function (oDimensionDetailsSet) {
			var aName = [];
			for (var oDimDetails in oDimensionDetailsSet)
				aName.push(oDimDetails.name);
			return aName.sort().join(";");
		};
		if (compileDimensionNames(oPreviousDimensionDetailsSet) != compileDimensionNames(this.oDimensionDetailsSet))
			this.iTotalSize = -1;
		
		// remember column settings for later reference
		this.aAnalyticalInfo = aColumns; 
		
		// reset attributes holding previously loaded data
		this.mFinalLength = {};
		this.mLength = {};
		this.mKey = {};
		this.mOwnKey = {};
		this.mContexts = {};
		this.bNeedsUpdate = false;
	};

	AnalyticalBinding.prototype.getAnalyticalInfoForColumn = function(sColumnName) {
		return this.mAnalyticalInfoByProperty[sColumnName];
	};
	
	/**
	 * @public
	 * @function
	 * @name AnalyticalBinding.prototype.loadGroups
	 * @param {Object}
	 *            oGroupIdRanges Property names are group IDs to be loaded via the model. Property values are arrays of { startIndex, length,
	 *            threshold } describing the index ranges to be fetched.
	 */
	AnalyticalBinding.prototype.loadGroups = function(oGroupIdRanges) {
		var aGroupId = new Array();
		for ( var sGroupId in oGroupIdRanges) {
			aGroupId.push(sGroupId);
	
			// clean up existing loaded data for the given group ID
			delete this.mKey[sGroupId];
			delete this.mLength[sGroupId];
			delete this.mFinalLength[sGroupId];
			
			var aGroupIdRange = oGroupIdRanges[sGroupId];
	
			for (var i = 0; i < aGroupIdRange.length; i++) {
				var oGroupIdRange = aGroupIdRange[i];
				// force reload of every requested index range for the given group ID
				this._getContextsForParentGroupId(sGroupId, oGroupIdRange.startIndex, oGroupIdRange.length,
						oGroupIdRange.threshold);
			}
	
			var aRequestId = new Array();
			for (var i = -1, sGroupId; sGroupId = aGroupId[++i]; ) {
				aRequestId.push(this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: sGroupId}));
			}
			this._considerRequestGrouping(aRequestId);
		}
	};
	
	/**
	 * @function
	 * @name AnalyticalBinding.prototype.getAnalyticalQueryResult()
	 */
	AnalyticalBinding.prototype.getAnalyticalQueryResult = function() {
		return this.oAnalyticalQueryResult;
	};
	
	
	/********************************
	 *** Private section follows
	 ********************************/

	
	/**
	 * Enumeration of request types implemented for the analytical binding.
	 * Every type <T> is implemented with the two methods prepare<T>Request and process<T>Response, names in proper upper camel case notation.
	 * @private
	 */
	AnalyticalBinding._requestType = { 
			groupMembersQuery : 1, // members of a named group G identified by its path /G1/G2/G3/.../G/  
			totalSizeQuery : 2, // total number of entities in result matching all specified filter conditions 
			groupMembersAutoExpansionQuery : 3, // all members residing in a group or sub group w.r.t. a given group ID  
			levelMembersQuery : 4 // members of a given level 
			};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getContextsForParentContext
	 */
	AnalyticalBinding.prototype._getContextsForParentContext = function(oParentContext, iStartIndex, iLength,
			iThreshold, iLevel, iNumberOfExpandedLevels) {
		if (oParentContext === undefined) return []; // API robustness
		if (oParentContext && oParentContext.getPath() == "/artificialRootContent") {
			// special case for artificial root contexts: adjust context to point to the real path
			oParentContext = this.getModel().getContext("/");
		}
		var sParentGroupId = this._getGroupIdFromContext(oParentContext, iLevel);
		return this._getContextsForParentGroupId(sParentGroupId, iStartIndex, iLength, iThreshold, iNumberOfExpandedLevels);
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getContextsForParentContext
	 */
	AnalyticalBinding.prototype._getContextsForParentGroupId = function(sParentGroupId, iStartIndex, iLength,
			iThreshold, iNumberOfExpandedLevels) {
		if (sParentGroupId === undefined) return []; // API robustness
	
		//	Set default values if start index, threshold, length or number of expanded levels are not defined
		if (!iStartIndex) iStartIndex = 0;
	
		if (!iLength) iLength = this.oModel.iSizeLimit;
	
		if (this.mFinalLength[sParentGroupId] && this.mLength[sParentGroupId] < iLength)
			iLength = this.mLength[sParentGroupId];
	
		if (!iThreshold) iThreshold = 0;

		if (!iNumberOfExpandedLevels) iNumberOfExpandedLevels = 0;
		if (sParentGroupId == null) {
			if (iNumberOfExpandedLevels > 0) {
				jQuery.sap.log.fatal("invalid request to determine nodes of root context");
				return null;
			}
		}
		else {			
			if (this._getGroupIdLevel(sParentGroupId) >= this.aAggregationLevel.length && iNumberOfExpandedLevels > 0) {
				jQuery.sap.log.fatal("invalid request to determine nodes of context with group ID " + sParentGroupId);
				return null;
			}
			if (this._getGroupIdLevel(sParentGroupId) + iNumberOfExpandedLevels > this.aAggregationLevel.length) {
				// need to adjust number of levels to expand
				iNumberOfExpandedLevels = this.aAggregationLevel.length - this._getGroupIdLevel(sParentGroupId) - 1;
			}
		}
	
		var aContext, bLoadContexts, oGroupSection, aAutoExpansionGroupHeaderPath, oGroupExpansionFirstMissingMember, missingMemberCount;
		
		var bGroupLevelAutoExpansionIsActive = iNumberOfExpandedLevels > 0 && sParentGroupId != null;
		if (bGroupLevelAutoExpansionIsActive) {
			var iMinRequiredLevel = this._getGroupIdLevel(sParentGroupId);
			var iAutoExpandGroupsToLevel = iMinRequiredLevel + iNumberOfExpandedLevels;
			oGroupExpansionFirstMissingMember = this._calculateRequiredGroupExpansion(sParentGroupId, iAutoExpandGroupsToLevel, iStartIndex, iLength + iThreshold);
			var bDataAvailable = oGroupExpansionFirstMissingMember.groupId_Missing == null;
			// the following line further reliefs the condition to load data by just looking at the sub-tree
			bDataAvailable = bDataAvailable 
				// first missing member is in a different upper level sub-tree, e.g. sParentGroupId: /A/B/C groupId_Missing: /A/X
				|| oGroupExpansionFirstMissingMember.groupId_Missing.length < sParentGroupId.length
				// first missing member is in a different lower level sub-tree, e.g. sParentGroupId: /A/B groupId_Missing: /A/C/D
				|| oGroupExpansionFirstMissingMember.groupId_Missing.substring(0, sParentGroupId.length) != sParentGroupId;
			if (bDataAvailable) {
				jQuery.sap.log.debug("auto expand: data available for group ID " + sParentGroupId);
				
				aContext = this._getLoadedContextsForGroup(sParentGroupId, iStartIndex, iLength);				
			}
			else {
				missingMemberCount = iLength + iThreshold;
			}
			bLoadContexts = !bDataAvailable;
		}
		else { // no automatic expansion of group levels
			aContext = this._getLoadedContextsForGroup(sParentGroupId, iStartIndex, iLength);
			oGroupSection = this._calculateRequiredGroupSection(sParentGroupId, iStartIndex, iLength, iThreshold, aContext);
			var bPreloadContexts = oGroupSection.length > 0 && iLength < oGroupSection.length;
			bLoadContexts = (aContext.length != iLength
							 && !(this.mFinalLength[sParentGroupId] && aContext.length >= this.mLength[sParentGroupId] - iStartIndex))
							|| bPreloadContexts;
		}
	
		if (!bLoadContexts)
			// all data available so no request will be issued that might be related to some group of requests
			this._cleanupGroupingForCompletedRequest(this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: sParentGroupId}));
	
		// check if metadata are already available
		if (this.oModel.getServiceMetadata()) {
			// If rows are missing send a request
			if (bLoadContexts) {
				var bNeedTotalSize = this.bProvideTotalSize && this.iTotalSize == -1 && !this._isRequestPending(this._getRequestId(AnalyticalBinding._requestType.totalSizeQuery));
				var bExecuteRequest = true;
				var aMembersRequestId;
				if (this.bUseBatchRequests) {
					if (bGroupLevelAutoExpansionIsActive) {
						aMembersRequestId = this._prepareGroupMembersAutoExpansionRequestIds(sParentGroupId, iNumberOfExpandedLevels);						
						for (var i = -1, sRequestId; sRequestId = aMembersRequestId[++i]; ) {
							if (this._isRequestPending(sRequestId)) {
								bExecuteRequest = false; 
								break;
							}
						}
						if (bExecuteRequest) {
							this.aRequestQueue.push([ AnalyticalBinding._requestType.groupMembersAutoExpansionQuery, sParentGroupId, oGroupExpansionFirstMissingMember, missingMemberCount, iNumberOfExpandedLevels ]);
						}
					}
					else { // ! bGroupLevelAutoExpansionIsActive
						bExecuteRequest = !this._isRequestPending(this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: sParentGroupId}));
						if (bExecuteRequest) {
							this.aRequestQueue.push([ AnalyticalBinding._requestType.groupMembersQuery, sParentGroupId, oGroupSection.startIndex, oGroupSection.length ]);
							aMembersRequestId = [ this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: sParentGroupId}) ];
						}
					}
					if (bExecuteRequest && bNeedTotalSize) {
						aMembersRequestId.push(this._getRequestId(AnalyticalBinding._requestType.totalSizeQuery));
						this._considerRequestGrouping(aMembersRequestId);						
						this.aRequestQueue.push([ AnalyticalBinding._requestType.totalSizeQuery ]);
					}
					if (bExecuteRequest) {
						if (sParentGroupId == null) { // root node is requested, so discard all not received responses, because the entire table must be set up from scratch
							this._abortAllPendingRequests();  
						}
						
						jQuery.sap.delayedCall(0, this, AnalyticalBinding.prototype._processRequestQueue);
					}
				}
				else { // ! bUseBatchRequests
					var oMemberRequestDetails;
					if (bGroupLevelAutoExpansionIsActive) {
						aMembersRequestId = this._prepareGroupMembersAutoExpansionRequestIds(sParentGroupId, iNumberOfExpandedLevels);						
						for (var i = -1, sRequestId; sRequestId = aMembersRequestId[++i]; ) {
							if (this._isRequestPending(sRequestId)) {
								bExecuteRequest = false; 
								break;
							}
						}
						if (bExecuteRequest) {						
							oMemberRequestDetails = this._prepareGroupMembersAutoExpansionQueryRequest(AnalyticalBinding._requestType.groupMembersAutoExpansionQuery, sParentGroupId, oGroupExpansionFirstMissingMember, missingMemberCount, iNumberOfExpandedLevels);
						}
					}
					else { // ! bGroupLevelAutoExpansionIsActive
						bExecuteRequest = !this._isRequestPending(this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: sParentGroupId}));
						if (bExecuteRequest) {
							oMemberRequestDetails = this._prepareGroupMembersQueryRequest(AnalyticalBinding._requestType.groupMembersQuery, sParentGroupId, oGroupSection.startIndex, oGroupSection.length);
							aMembersRequestId = [ oMemberRequestDetails.sRequestId ];
						}
					}
					if (bExecuteRequest) {
						if (sParentGroupId == null) { // root node is requested, so discard all not received responses, because the entire table must be set up from scratch
							this._abortAllPendingRequests();  
						}
						
						this._executeQueryRequest(oMemberRequestDetails);
						if (bNeedTotalSize && !oMemberRequestDetails.bIsFlatListRequest) {
							aMembersRequestId.push(this._getRequestId(AnalyticalBinding._requestType.totalSizeQuery));						
							this._considerRequestGrouping(aMembersRequestId);						
							this._executeQueryRequest(this._prepareTotalSizeQueryRequest(AnalyticalBinding._requestType.totalSizeQuery));
						}
					}
				}
			}
		}
	
		return aContext;
	};
	
	AnalyticalBinding.prototype._processRequestQueue = function() {
		if (this.aRequestQueue.length == 0) return;
	
		var aRequestDetails = [];
		var bFoundFlatListRequest = false;

		// create request objects: process group member requests first to detect flat list requests 
		for (var i = -1, aRequestQueueEntry; aRequestQueueEntry = this.aRequestQueue[++i];) {
			if (aRequestQueueEntry[0] == AnalyticalBinding._requestType.groupMembersQuery) { // request type is at array index 0
				var oRequestDetails = AnalyticalBinding.prototype._prepareGroupMembersQueryRequest.apply(this, aRequestQueueEntry);
				bFoundFlatListRequest = bFoundFlatListRequest || oRequestDetails.bIsFlatListRequest;
				aRequestDetails.push(oRequestDetails);
			}
		}

		// create request objects for all other request types 
		for (var i = -1, aRequestQueueEntry; aRequestQueueEntry = this.aRequestQueue[++i];) {
			var oRequestDetails = null;
			switch (aRequestQueueEntry[0]) { // different request types
			case AnalyticalBinding._requestType.groupMembersQuery:
				continue; // handled above
			case AnalyticalBinding._requestType.totalSizeQuery:
				if (!bFoundFlatListRequest) { 
					oRequestDetails = AnalyticalBinding.prototype._prepareTotalSizeQueryRequest.apply(this, aRequestQueueEntry);
					aRequestDetails.push(oRequestDetails);
				}
				break;
			case AnalyticalBinding._requestType.groupMembersAutoExpansionQuery:
				oRequestDetails = AnalyticalBinding.prototype._prepareGroupMembersAutoExpansionQueryRequest.apply(this, aRequestQueueEntry);
				for (var j = -1, oLevelMembersRequestDetails; oLevelMembersRequestDetails = oRequestDetails.aGroupMembersAutoExpansionRequestDetails[++j]; ) {
					aRequestDetails.push(oLevelMembersRequestDetails);
				}
				break;
			default: 
				jQuery.sap.log.fatal("unhandled request type " + this.aRequestQueue[i][0]);
				continue;
			}
		}
	
		// execute them either directly in case of a single request or via a batch request
	
		if (aRequestDetails.length > 1) this._executeBatchRequest(aRequestDetails);
		else this._executeQueryRequest(aRequestDetails[0]);
	
		// clear queue
		this.aRequestQueue = [];
	};
	
	/** *************************************************************** */
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._prepareGroupMembersQueryRequest
	 */
	AnalyticalBinding.prototype._prepareGroupMembersQueryRequest = function(iRequestType, sGroupId, iStartIndex, iLength) {
		var aGroupId = [];
		var iCurrentAnalyticalInfoVersion = this.iAnalyticalInfoVersionNumber;
	
		// (0) set up analytical OData request object
		var oAnalyticalQueryRequest = new odata4analytics.QueryResultRequest(this.oAnalyticalQueryResult);
		oAnalyticalQueryRequest.setResourcePath(this._getResourcePath());
		oAnalyticalQueryRequest.getSortExpression().clear();

	
		// (1) analyze aggregation level of sGroupId
	
		// indexes to elements of this.aMaxAggregationLevel marking begin and end of the requested child level
		var iChildGroupFromLevel = 0, iChildGroupToLevel = -1;
		if (sGroupId) {
			aGroupId = this._getGroupIdComponents(sGroupId);
			iChildGroupFromLevel = iChildGroupToLevel = aGroupId.length;
	
			var iUngroupedParentLevelCount = 0;
			// determine offset for child level (depends on grouped column property of higher aggregation levels)
			// Ex: Assume aMaxAggregationLevel with (G=grouped,U=ungrouped): [ G1 U1 U2 G2 U3 U4 G3 F5 F6 ... ]
			// For sGroupId = "G1/G2", initial iChildGroupFromLevel is 2. The following loop will increment it to 4
			// and consequently point to U3
			for (var i = 0, iLevel = 0; i < iChildGroupFromLevel; iLevel++) {
				if (this.oDimensionDetailsSet[this.aMaxAggregationLevel[iLevel]].grouped == false)
					++iUngroupedParentLevelCount;
				else
					++i;
			}
			// adjust child levels by number of ungrouped parent levels!
			iChildGroupFromLevel = iChildGroupToLevel = iChildGroupFromLevel + iUngroupedParentLevelCount;
	
			// determine index range for aggregation levels included in child level
			// (rule: take all lower levels up to and including the first grouped level; G3 in above example
			if (this.aMaxAggregationLevel.length > 0) {
				while (this.oDimensionDetailsSet[this.aMaxAggregationLevel[iChildGroupToLevel]].grouped == false)
					if (++iChildGroupToLevel == this.aMaxAggregationLevel.length) break;
			}
		}
	
		// (2) determine if the sub groups will effectively represent leafs (relevant for un-"total"ed columns, see below)
		var bIsLeafGroupsRequest = iChildGroupToLevel >= this.aMaxAggregationLevel.length - 1;
	
		// (3) set aggregation level for child nodes
		var aAggregationLevel = this.aMaxAggregationLevel.slice(0, iChildGroupToLevel + 1);
		oAnalyticalQueryRequest.setAggregationLevel(aAggregationLevel);
		for (var i = 0; i < aAggregationLevel.length; i++) {
			// specify components requested for this level (key, text, attributes) 
			var oDimensionDetails = this.oDimensionDetailsSet[aAggregationLevel[i]];
			var bIncludeKey = (oDimensionDetails.keyPropertyName != undefined);
			// as we combine the key and text in the group header we also need the text! 
			var bIncludeText = (oDimensionDetails.textPropertyName != undefined);
			oAnalyticalQueryRequest.includeDimensionKeyTextAttributes(oDimensionDetails.name, // bIncludeKey: No, always needed!
			true, bIncludeText, oDimensionDetails.aAttributeName);

			// define a default sort order in case no sort criteria have been provided externally 
			if (oDimensionDetails.grouped) {
				oAnalyticalQueryRequest.getSortExpression().addSorter(aAggregationLevel[i], odata4analytics.SortOrder.Ascending);					
			}
		}
	
		// (4) set filter
		var oFilterExpression = oAnalyticalQueryRequest.getFilterExpression();
		oFilterExpression.clear();
		if (this.aApplicationFilter) oFilterExpression.addUI5FilterConditions(this.aApplicationFilter);
		if (this.aControlFilter) oFilterExpression.addUI5FilterConditions(this.aControlFilter);
	
		if (iChildGroupFromLevel >= 1) {
			for (var i = 0, l = aGroupId.length; i < l; i++) {
				oFilterExpression.addCondition(this.aAggregationLevel[i], FilterOperator.EQ, aGroupId[i]);
			}
		}
	
		// (5) set measures as requested per column
		var bIncludeRawValue;
		var bIncludeFormattedValue;
		var bIncludeUnitProperty;
		var oMeasureDetails;
	
		var aSelectedUnitPropertyName = new Array();
	
		if (sGroupId != null || this.bProvideGrandTotals) {
			// select measures if the requested group is not the root context i.e. the grand totals row, or grand totals shall be determined 
			oAnalyticalQueryRequest.setMeasures(this.aMeasureName);
	
			for ( var sMeasureName in this.oMeasureDetailsSet) {
				oMeasureDetails = this.oMeasureDetailsSet[sMeasureName];
				if (!bIsLeafGroupsRequest && this.mAnalyticalInfoByProperty[sMeasureName].total == false) {
					bIncludeRawValue = false;
					bIncludeFormattedValue = false;
					bIncludeUnitProperty = false;
				} else {
					bIncludeRawValue = (oMeasureDetails.rawValuePropertyName != undefined);
					bIncludeFormattedValue = (oMeasureDetails.formattedValuePropertyName != undefined);
					bIncludeUnitProperty = (oMeasureDetails.unitPropertyName != undefined);
					if (bIncludeUnitProperty) {
						// remember unit property together with using measure raw value property for response analysis in success handler
						if (aSelectedUnitPropertyName.indexOf(oMeasureDetails.unitPropertyName) == -1) {
							aSelectedUnitPropertyName.push(oMeasureDetails.unitPropertyName);
						}
					}
				}
				oAnalyticalQueryRequest.includeMeasureRawFormattedValueUnit(oMeasureDetails.name, bIncludeRawValue,
						bIncludeFormattedValue, bIncludeUnitProperty);
			}
			// exclude those unit properties from the selected that are included in the current aggregation level
			for ( var i in aAggregationLevel) {
				var iMatchingIndex;
				if ((iMatchingIndex = aSelectedUnitPropertyName.indexOf(aAggregationLevel[i])) != -1)
					aSelectedUnitPropertyName.splice(iMatchingIndex, 1);
			}
		}
	
		// (6) set sort order
		var oSorter = oAnalyticalQueryRequest.getSortExpression();
		for (var i = 0; i < this.aSorter.length; i++) {
			if (this.aSorter[i]) oSorter.addSorter(this.aSorter[i].sPath, 
					this.aSorter[i].bDescending ? odata4analytics.SortOrder.Descending
							: odata4analytics.SortOrder.Ascending);
		}
	
		// (7) set result page boundaries
		if (iLength == 0) 
			jQuery.sap.log.fatal("unhandled case: load 0 entities of sub group");
		oAnalyticalQueryRequest.setResultPageBoundaries(iStartIndex + 1, iStartIndex + iLength);
	
		// (8) request result entity count
		oAnalyticalQueryRequest.setRequestOptions(null, !this.mFinalLength[sGroupId]);
	
		return {
			iRequestType : iRequestType,
			sRequestId : this._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: sGroupId}),
			oAnalyticalQueryRequest : oAnalyticalQueryRequest,
			sGroupId : sGroupId,
			aSelectedUnitPropertyName : aSelectedUnitPropertyName,
			aAggregationLevel : aAggregationLevel,
			bIsFlatListRequest : bIsLeafGroupsRequest && iChildGroupFromLevel == 0,
			bIsLeafGroupsRequest : bIsLeafGroupsRequest,
			iStartIndex : iStartIndex,
			iLength : iLength
		};
	};

	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._prepareTotalSizeQueryRequest
	 */
	AnalyticalBinding.prototype._prepareTotalSizeQueryRequest = function(iRequestType) {
		var iCurrentAnalyticalInfoVersion = this.iAnalyticalInfoVersionNumber;
	
		// (0) set up analytical OData request object
		var oAnalyticalQueryRequest = new odata4analytics.QueryResultRequest(this.oAnalyticalQueryResult);
		oAnalyticalQueryRequest.setResourcePath(this._getResourcePath());
	
		// (1) set aggregation level
		oAnalyticalQueryRequest.setAggregationLevel(this.aMaxAggregationLevel);
		oAnalyticalQueryRequest.setMeasures([]);

		// (2) set filter
		var oFilterExpression = oAnalyticalQueryRequest.getFilterExpression();
		oFilterExpression.clear();
		if (this.aApplicationFilter) oFilterExpression.addUI5FilterConditions(this.aApplicationFilter);
		if (this.aControlFilter) oFilterExpression.addUI5FilterConditions(this.aControlFilter);

		// (2) fetch almost no data
		oAnalyticalQueryRequest.setResultPageBoundaries(1, 1);

		// (3) request result entity count
		oAnalyticalQueryRequest.setRequestOptions(null, true);
		
		return {
			iRequestType : iRequestType,
			sRequestId : this._getRequestId(AnalyticalBinding._requestType.totalSizeQuery),
			oAnalyticalQueryRequest : oAnalyticalQueryRequest
		};		
	};


	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._prepareGroupMembersAutoExpansionQueryRequest
	 */
	AnalyticalBinding.prototype._prepareGroupMembersAutoExpansionQueryRequest = function(iRequestType, sGroupId, oGroupExpansionFirstMissingMember, iLength, iNumberOfExpandedLevels) {

		// local helper function for creating filter expressions for all group level requests
		/* 
		 * Let G be the group ID for the root for the first missing member, e.g. G = /A/B/C/D/.../W/X/, and (optional) startIndex_Missing > 0 for the children of X. 
		 * Let P_1, P_2, ... be the properties for the different grouping levels.
		 * Then, for every level l, 1 <= l <= iAutoExpandGroupsToLevel, the filter expression
		 * is // every such expression is an instance of aLevelFilterCondition, see in code below
		 *   [0] ( P_1 = A and P_2 = B and .. P_l >= X )
		 *   [1] or ( P_1 = A and P_2 = B and .. P_(l-1) > W )    // every such line is an instance of aIntermediateLevelFilterCondition, see in code below
		 *       ...
		 *   [N] or ( P_1 > A )
		 *   assuming that P_1, P_2, ... are all to be sorted in ascending order. For any deviation, replace > with <.
		 *   
		 *   Additional rules considered:
		 *   (R1) For every auto-expand level with a higher number than the level of the first missing member,
		 *     the strict comparison (< or >) has to include equality (<= or >=) to match all needed members of these deep levels.
		 *   (R2) If startIndex_Missing > 0, then the R1 does not apply. here,
		 *        (R2.1) the strict comparison (< or >) must be replaced by equality (=)
		 *        (R2.2) the partial filter expression for every auto-expand level with a higher number than the level of the first missing member
		 *               must be extended by a condition P_Y > Y, where Y is the child of X at position startIndex_Missing - 1, 
		 *               and P_Y is the property for this grouping level. 
		 */
		var prepareLevelFilterExpressions = function(oGroupExpansionFirstMissingMember, iAutoExpandGroupsToLevel) {
			if (oGroupExpansionFirstMissingMember.groupId_Missing == null) {
				jQuery.sap.log.fatal("missing group Id not present");
				return aFilterArray;
			}
			var aGroupIdComponents_Missing = that._getGroupIdComponents(oGroupExpansionFirstMissingMember.groupId_Missing);
			var iGroupIdLevel_Missing = aGroupIdComponents_Missing.length;
			if (iGroupIdLevel_Missing > iAutoExpandGroupsToLevel) {
				jQuery.sap.log.fatal("the given group ID is too deep for requested level for auto expansion");
				return aFilterArray;
			}

			// create template for every term of the filter expression 
			var aTemplateFilter = [];
			for (var i = 0; i < iGroupIdLevel_Missing; i++) {
				var sGroupProperty = that.aAggregationLevel[i];
				var sValue = aGroupIdComponents_Missing[i];
				var sFilterOperator = that._getFilterOperatorMatchingPropertySortOrder(sGroupProperty);
				aTemplateFilter[i] = new sap.ui.model.Filter(sGroupProperty, sFilterOperator, sValue);
			}
			
			// if first missing member start within a partially loaded group, an extra condition will be needed below 
			var oFirstMissingMemberStartIndexLastKnownFilterCondition = null;
			if (oGroupExpansionFirstMissingMember.startIndex_Missing > 0) {
				var oFirstMissingMemberStartIndexLastKnownGroupContextKey =	that.mKey[oGroupExpansionFirstMissingMember.groupId_Missing]
						[oGroupExpansionFirstMissingMember.startIndex_Missing - 1];
				var oFirstMissingMemberStartIndexLastKnownObject = that.oModel.getObject("/" + oFirstMissingMemberStartIndexLastKnownGroupContextKey);
				var sFirstMissingMemberStartIndexAggregationLevel = that.aAggregationLevel[iGroupIdLevel_Missing];
				var sFirstMissingMemberStartIndexLastKnownValue = oFirstMissingMemberStartIndexLastKnownObject
					[sFirstMissingMemberStartIndexAggregationLevel];
				oFirstMissingMemberStartIndexLastKnownFilterCondition = new sap.ui.model.Filter(sFirstMissingMemberStartIndexAggregationLevel, 
						that._getFilterOperatorMatchingPropertySortOrder(sFirstMissingMemberStartIndexAggregationLevel, false), 
						sFirstMissingMemberStartIndexLastKnownValue);
			}
			
			
			// now create the filter expressions (filter object arrays) for every group level to be requested
			var aFilterArray = [];
			
			for (var iLevel = 0; iLevel < iAutoExpandGroupsToLevel; iLevel++) {
				var aLevelFilterCondition = [];
				var iNumberOfIntermediateLevelConditions = Math.min(iGroupIdLevel_Missing, iLevel + 1); 
				for (var iIntermediateLevel = 0; iIntermediateLevel < iNumberOfIntermediateLevelConditions; iIntermediateLevel++) {
					var aIntermediateLevelFilterCondition = [];
					var iNumberOfLevelConditions = Math.min(iGroupIdLevel_Missing, iIntermediateLevel + 1); 
					var bAddExtraConditionForFirstMissingMemberStartIndexLastKnown = 
						oGroupExpansionFirstMissingMember.startIndex_Missing > 0;
					for (var iLevelCondition = 0; iLevelCondition < iNumberOfLevelConditions; iLevelCondition++) {
						// create filter condition from template
						var oFilterCondition = new sap.ui.model.Filter("x", sap.ui.model.FilterOperator.EQ, "x");
						oFilterCondition = jQuery.extend(true, oFilterCondition, aTemplateFilter[iLevelCondition]);
						
						if (iNumberOfLevelConditions > 1 && iLevelCondition < iNumberOfLevelConditions - 1)
							oFilterCondition.sOperator = sap.ui.model.FilterOperator.EQ;
						if (iLevelCondition == iGroupIdLevel_Missing - 1
							&& iLevel > iGroupIdLevel_Missing - 1
							&& !bAddExtraConditionForFirstMissingMemberStartIndexLastKnown) { // rule (R1)
							if (oFilterCondition.sOperator == sap.ui.model.FilterOperator.GT)
								oFilterCondition.sOperator = sap.ui.model.FilterOperator.GE;
							else // it must be LT
								oFilterCondition.sOperator = sap.ui.model.FilterOperator.LE;
						}
						aIntermediateLevelFilterCondition.push(oFilterCondition);
					}
					// create the instance for ( P_1 = A and P_2 = B and .. P_(l-1) > W )
					if (aIntermediateLevelFilterCondition.length > 0) {
						aLevelFilterCondition.push(new sap.ui.model.Filter(aIntermediateLevelFilterCondition, true));
						// add an extra intermediate filter condition to reflect start position at oGroupExpansionFirstMissingMember.startIndex_Missing
						if (iLevel > iGroupIdLevel_Missing - 1
							&& iIntermediateLevel == iGroupIdLevel_Missing - 1
							&& bAddExtraConditionForFirstMissingMemberStartIndexLastKnown) { // rule (R2)
							// create a copy of the constructed intermediate filter condition 
							var aStartIndexFilterCondition = [];
							for (var i = 0; i < aIntermediateLevelFilterCondition.length; i++) {
								var oConditionCopy = new sap.ui.model.Filter("x", sap.ui.model.FilterOperator.EQ, "x");
								oConditionCopy = jQuery.extend(true, oConditionCopy, aIntermediateLevelFilterCondition[i]);
								aStartIndexFilterCondition.push(oConditionCopy);
							}
							aStartIndexFilterCondition[iGroupIdLevel_Missing - 1].sOperator = sap.ui.model.FilterOperator.EQ; // (R2.1)
							aStartIndexFilterCondition.push(oFirstMissingMemberStartIndexLastKnownFilterCondition); // (R2.2)

							aLevelFilterCondition.push(new sap.ui.model.Filter(aStartIndexFilterCondition, true));
							break;
						}
					}
				}
				// create the entire filter expression
				if (aLevelFilterCondition.length > 0)
					aFilterArray[iLevel] = new sap.ui.model.Filter(aLevelFilterCondition, false);
				else
					aFilterArray[iLevel] = null;
			}
			
			return aFilterArray;
		};
		
		// local helper function for requesting members of a given level (across groups) - copied from _prepareGroupMembersQueryRequest & adapted  
		var prepareLevelMembersQueryRequest = function(iRequestType, sGroupId, iLevel, aGroupContextFilter, 
				iStartIndex, iLength, bAvoidLengthUpdate, bUseStartIndexForSkip) {
			var aGroupId = [];
			var iCurrentAnalyticalInfoVersion = that.iAnalyticalInfoVersionNumber;
		
			// (1) set up analytical OData request object
			var oAnalyticalQueryRequest = new odata4analytics.QueryResultRequest(that.oAnalyticalQueryResult);
			oAnalyticalQueryRequest.setResourcePath(that._getResourcePath());
			oAnalyticalQueryRequest.getSortExpression().clear();
			// (2) analyze aggregation level of sGroupId
			
			// indexes to elements of this.aMaxAggregationLevel marking begin and end of the requested child level
			var iChildGroupFromLevel = 0, iChildGroupToLevel = -1;
			iChildGroupFromLevel = iChildGroupToLevel = iLevel - 1;
	
			var iUngroupedParentLevelCount = 0;
			// determine offset for child level (depends on grouped column property of higher aggregation levels)
			// Ex: Assume aMaxAggregationLevel with (G=grouped,U=ungrouped): [ G1 U1 U2 G2 U3 U4 G3 F5 F6 ... ]
			// For sGroupId = "G1/G2", initial iChildGroupFromLevel is 2. The following loop will increment it to 4
			// and consequently point to U3
			for (var i = 0, iParentLevel = 0; i < iChildGroupFromLevel; iParentLevel++) {
				if (that.oDimensionDetailsSet[that.aMaxAggregationLevel[iParentLevel]].grouped == false) {
					++iUngroupedParentLevelCount;
				} else {
					++i;
				}
			}
			// adjust child levels by number of ungrouped parent levels!
			iChildGroupFromLevel = iChildGroupToLevel = iChildGroupFromLevel + iUngroupedParentLevelCount;
	
			// determine index range for aggregation levels included in child level
			// (rule: take all lower levels up to and including the first grouped level; G3 in above example
			if (that.aMaxAggregationLevel.length > 0) {
				while (that.oDimensionDetailsSet[that.aMaxAggregationLevel[iChildGroupToLevel]].grouped == false) {
					if (++iChildGroupToLevel == that.aMaxAggregationLevel.length) {
						break;
					}
				}
			}

			// determine if the sub groups will effectively represent leafs (relevant for un-"total"ed columns, see below)
			var bIsLeafGroupsRequest = iChildGroupToLevel >= that.aMaxAggregationLevel.length - 1;
		
			// (3) set aggregation level for child nodes
			var aAggregationLevel = that.aMaxAggregationLevel.slice(0, iChildGroupToLevel + 1);
			oAnalyticalQueryRequest.setAggregationLevel(aAggregationLevel);

			for (var i = 0; i < aAggregationLevel.length; i++) {
				var oDimensionDetails = that.oDimensionDetailsSet[aAggregationLevel[i]];
				var bIncludeKey = (oDimensionDetails.keyPropertyName != undefined);
				var bIncludeText = (oDimensionDetails.textPropertyName != undefined);
				oAnalyticalQueryRequest.includeDimensionKeyTextAttributes(oDimensionDetails.name, // bIncludeKey: No, always needed!
				true, bIncludeText, oDimensionDetails.aAttributeName);
				
				// define a default sort order in case no sort criteria have been provided externally
				if (oDimensionDetails.grouped) {
					oAnalyticalQueryRequest.getSortExpression().addSorter(aAggregationLevel[i], odata4analytics.SortOrder.Ascending);					
				}
			}
		
			// (4) set filter
			var oFilterExpression = oAnalyticalQueryRequest.getFilterExpression();
			oFilterExpression.clear();
			if (that.aApplicationFilter) oFilterExpression.addUI5FilterConditions(that.aApplicationFilter);
			if (that.aControlFilter) oFilterExpression.addUI5FilterConditions(that.aControlFilter);
			oFilterExpression.addUI5FilterConditions(aGroupContextFilter);

			// (5) set measures as requested per column
			var bIncludeRawValue;
			var bIncludeFormattedValue;
			var bIncludeUnitProperty;
			var oMeasureDetails;
		
			var aSelectedUnitPropertyName = new Array();
		
			// select measures if the requested group is not the root context i.e. the grand totals row, or grand totals shall be determined 
			oAnalyticalQueryRequest.setMeasures(that.aMeasureName);
		
			for ( var sMeasureName in that.oMeasureDetailsSet) {
				oMeasureDetails = that.oMeasureDetailsSet[sMeasureName];
				if (!bIsLeafGroupsRequest && that.mAnalyticalInfoByProperty[sMeasureName].total == false) {
					bIncludeRawValue = false;
					bIncludeFormattedValue = false;
					bIncludeUnitProperty = false;
				} else {
					bIncludeRawValue = (oMeasureDetails.rawValuePropertyName != undefined);
					bIncludeFormattedValue = (oMeasureDetails.formattedValuePropertyName != undefined);
					bIncludeUnitProperty = (oMeasureDetails.unitPropertyName != undefined);
					if (bIncludeUnitProperty) {
						// remember unit property together with using measure raw value property for response analysis in success handler
						if (aSelectedUnitPropertyName.indexOf(oMeasureDetails.unitPropertyName) == -1) {
							aSelectedUnitPropertyName.push(oMeasureDetails.unitPropertyName);
						}
					}
				}
				oAnalyticalQueryRequest.includeMeasureRawFormattedValueUnit(oMeasureDetails.name, bIncludeRawValue,
						bIncludeFormattedValue, bIncludeUnitProperty);
			}
			// exclude those unit properties from the selected that are included in the current aggregation level
			for ( var i in aAggregationLevel) {
				var iMatchingIndex;
				if ((iMatchingIndex = aSelectedUnitPropertyName.indexOf(aAggregationLevel[i])) != -1)
					aSelectedUnitPropertyName.splice(iMatchingIndex, 1);
			}
		
			// (6) set sort order
			var oSorter = oAnalyticalQueryRequest.getSortExpression();
			for (var i = 0; i < that.aSorter.length; i++) {
				if (that.aSorter[i]) oSorter.addSorter(that.aSorter[i].sPath, 
						that.aSorter[i].bDescending ? odata4analytics.SortOrder.Descending
								: odata4analytics.SortOrder.Ascending);
			}

			// (7) set result page boundaries
			if (iLength == 0) 
				jQuery.sap.log.fatal("unhandled case: load 0 entities of sub group");
			var iEffectiveStartIndex = iStartIndex;
			if (!bUseStartIndexForSkip) iEffectiveStartIndex = 0; // and the skip-value is encoded in the filter expression; still the start index is relevant and kept (see below) for booking the result entries
			oAnalyticalQueryRequest.setResultPageBoundaries(iEffectiveStartIndex + 1, iEffectiveStartIndex + iLength);
		
			return {
				iRequestType : iRequestType,
				sRequestId : that._getRequestId(AnalyticalBinding._requestType.levelMembersQuery, { groupId: sGroupId, level: iLevel }),
				oAnalyticalQueryRequest : oAnalyticalQueryRequest,
				iLevel : iLevel,
				aSelectedUnitPropertyName : aSelectedUnitPropertyName,
				aAggregationLevel : aAggregationLevel,
				bIsFlatListRequest : bIsLeafGroupsRequest,
				bIsLeafGroupsRequest : bIsLeafGroupsRequest,
				iStartIndex : iStartIndex,
				iLength : iLength,
				bAvoidLengthUpdate : bAvoidLengthUpdate
			};
		};

		// function implementation starts here
		var that = this;
		var aGroupMembersAutoExpansionRequestDetails = [];
		var aRequestId = [];
		
		if (oGroupExpansionFirstMissingMember && this.bUseAcceleratedAutoExpand) {
			var iAutoExpandGroupsToLevel = this._getGroupIdLevel(sGroupId) + iNumberOfExpandedLevels + 1;
			var aGroupIdComponents_Missing = that._getGroupIdComponents(oGroupExpansionFirstMissingMember.groupId_Missing);
			var iGroupIdLevel_Missing = aGroupIdComponents_Missing.length;
			var aFilterArray = prepareLevelFilterExpressions(oGroupExpansionFirstMissingMember, iAutoExpandGroupsToLevel);
			
			for (var iLevel = 1; iLevel <= iAutoExpandGroupsToLevel; iLevel++) {
				var iStartIndex;
				// determine start index
				if (iLevel >= iGroupIdLevel_Missing + 2) iStartIndex = 0;
				else if (iLevel == iGroupIdLevel_Missing + 1) iStartIndex = oGroupExpansionFirstMissingMember.startIndex_Missing;
				else if (iGroupIdLevel_Missing > 0) {
					var sGroupIdAtLevel;
					if (iLevel == iGroupIdLevel_Missing) sGroupIdAtLevel = oGroupExpansionFirstMissingMember.groupId_Missing;
					else sGroupIdAtLevel= this._getGroupIdAncestors(oGroupExpansionFirstMissingMember.groupId_Missing, -(iGroupIdLevel_Missing - iLevel))[0];
					var sGroupIdAtParentLevel = this._getGroupIdAncestors(oGroupExpansionFirstMissingMember.groupId_Missing, -(iGroupIdLevel_Missing - iLevel + 1))[0]
					if (!sGroupIdAtParentLevel) jQuery.sap.log.fatal("failed to determine group id at parent level; group ID = " + sGroupId + ", level = " + iLevel);
					var iStartIndex = this.mKey[sGroupIdAtParentLevel].indexOf(this.mOwnKey[sGroupIdAtLevel]);
					if (iStartIndex == -1) jQuery.sap.log.fatal("failed to determine position of value " + sGroupIdAtLevel + " in group " + sGroupIdAtParentLevel);
					iStartIndex++; // point to first missing position
				}
				// determine other parameters of the request
				var iLengthForLevel = iLength > iLevel ? Math.ceil((iLength - iLevel)/(iAutoExpandGroupsToLevel - iLevel + 1)) : iLength;
				var aFilter = aFilterArray[iLevel - 1] ? [ aFilterArray[iLevel - 1] ] : [];
				
				var oLevelMembersRequestDetails = prepareLevelMembersQueryRequest(AnalyticalBinding._requestType.levelMembersQuery, sGroupId, 
						iLevel, aFilter, iStartIndex, iLengthForLevel, false, false); // rem: bUseStartIndexForSkip==false, b/c it is encoded in the filter condition
				aGroupMembersAutoExpansionRequestDetails.push(oLevelMembersRequestDetails);
				aRequestId.push(this._getRequestId(AnalyticalBinding._requestType.levelMembersQuery, { groupId: sGroupId, level: iLevel }))
			}
		}
		else { // simple auto expand (i.e. the not accelerated method)
			var iMinRequiredLevel = this._getGroupIdLevel(sGroupId) + 1;
			var iAutoExpandGroupsToLevel = iMinRequiredLevel + iNumberOfExpandedLevels;
			
			// construct filter condition for addressing the selected group
			var aFilter = [];
			var aGroupIdComponent = this._getGroupIdComponents(sGroupId);
			for (var i = 0; i < aGroupIdComponent.length; i++)
				aFilter.push(new sap.ui.model.Filter(this.aAggregationLevel[i], sap.ui.model.FilterOperator.EQ, aGroupIdComponent[i]));
			// reflect iStartIndex > 0 (in calling _getContextsForParentContext()) 
			// by adding one more condition for the first component of the oGroupExpansionFirstMissingMember
			var bAvoidLengthUpdateOnMinLevel = false;
			if (oGroupExpansionFirstMissingMember) {
				var sPropertyName = this.aAggregationLevel[aGroupIdComponent.length];
				var sPropertyValue = this._getGroupIdComponents(oGroupExpansionFirstMissingMember.groupId_Missing)[aGroupIdComponent.length];
				if (sPropertyValue)	{
					var sFilterOperator = this._getFilterOperatorMatchingPropertySortOrder(sPropertyName, true);
					aFilter.push(new sap.ui.model.Filter(sPropertyName, sFilterOperator, sPropertyValue));
					// this extra condition restricts the entities returned for the first minimum level, so we must not update the group length from the result!
					bAvoidLengthUpdateOnMinLevel = true;
				}
			}
			
			for (var iLevel = iMinRequiredLevel; iLevel <= iAutoExpandGroupsToLevel; iLevel++) {
				var iLengthForLevel = iLength > iLevel ? Math.ceil((iLength - iLevel)/(iAutoExpandGroupsToLevel - iLevel + 1)) : iLength;
				var oLevelMembersRequestDetails = prepareLevelMembersQueryRequest(AnalyticalBinding._requestType.levelMembersQuery, sGroupId,
						iLevel, aFilter, 0 /* iStartIndex */, iLengthForLevel, 
						iLevel == iMinRequiredLevel ? bAvoidLengthUpdateOnMinLevel : false,
								true);
				aGroupMembersAutoExpansionRequestDetails.push(oLevelMembersRequestDetails);
				aRequestId.push(this._getRequestId(AnalyticalBinding._requestType.levelMembersQuery, { groupId: sGroupId, level: iLevel }))
			}
		}
		return {
			iRequestType : iRequestType,
			aRequestId : aRequestId,
			aGroupMembersAutoExpansionRequestDetails : aGroupMembersAutoExpansionRequestDetails,
			sGroupId : sGroupId,
			iLength : iLength
		};		
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._prepareGroupMembersAutoExpansionRequestIds
	 */
	AnalyticalBinding.prototype._prepareGroupMembersAutoExpansionRequestIds = function(sGroupId, iNumberOfExpandedLevels) {
		// intention of this function is to encapsulate the knowledge about steps to be taken
		// for creating request IDs for all relevant requests
		var iMinRequiredLevel = this._getGroupIdLevel(sGroupId) + 1;
		var iAutoExpandGroupsToLevel = iMinRequiredLevel + iNumberOfExpandedLevels;
		var aRequestId = [];
		for (var iLevel = iMinRequiredLevel; iLevel <= iAutoExpandGroupsToLevel; iLevel++) {
			aRequestId.push(this._getRequestId(AnalyticalBinding._requestType.levelMembersQuery, { groupId: sGroupId, level: iLevel }))
		}
		return aRequestId;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getQueryODataRequestOptions
	 */
	AnalyticalBinding.prototype._getQueryODataRequestOptions = function(oAnalyticalQueryRequest) {
		var sSelect = oAnalyticalQueryRequest.getURIQueryOptionValue("$select");
		var sFilter = oAnalyticalQueryRequest.getURIQueryOptionValue("$filter");
		var sOrderBy = oAnalyticalQueryRequest.getURIQueryOptionValue("$orderby");
		var sSkip = oAnalyticalQueryRequest.getURIQueryOptionValue("$skip");
		var sTop = oAnalyticalQueryRequest.getURIQueryOptionValue("$top");
		var sInlineCount = oAnalyticalQueryRequest.getURIQueryOptionValue("$inlinecount");
	
		if (this.mParameters["filter"]) sFilter += "and (" + this.mParameters["filter"] + ")";
	
		// construct OData request option parameters
		var aParam = [];
		if (sSelect) aParam.push("$select=" + sSelect);
		if (sFilter) aParam.push("$filter=" + sFilter);
		if (sOrderBy) aParam.push("$orderby=" + sOrderBy);
		if (sSkip) aParam.push("$skip=" + sSkip);
		if (sTop) aParam.push("$top=" + sTop);
		if (sInlineCount) aParam.push("$inlinecount=" + sInlineCount);
	
		return aParam;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._executeBatchRequest
	 */
	AnalyticalBinding.prototype._executeBatchRequest = function(aRequestDetails) {
		var iCurrentAnalyticalInfoVersion = this.iAnalyticalInfoVersionNumber;
	
		var that = this;
	
		var aBatchQueryRequest = [], aExecutedRequestDetails = [];
		for(var i = -1, oRequestDetails; oRequestDetails = aRequestDetails[++i];) {
			var oAnalyticalQueryRequest = oRequestDetails.oAnalyticalQueryRequest, sGroupId = oRequestDetails.sGroupId;
			
			if (oAnalyticalQueryRequest.getURIQueryOptionValue("$select") == null) {
				// no dimensions and no measures requested, so create an artificial empty root context (synonym for the regular "/")
				this.fireDataRequested(); // simulate the async behavior
				var oEmptyRootContext = this.getModel().getContext("/artificialRootContent");
	
				// perform all steps of fct fnSuccess (w/o calling it, b/c its argument is some data object and not a context
				sGroupId = null;
				this.mLength[sGroupId] = 1;
				this.mFinalLength[sGroupId] = true;
				this.mKey[sGroupId] = [ "artificialRootContent" ];
				this.bNeedsUpdate = true;
				// simulate the async behavior for the root context in case of having no sums (TODO: reconsider!)
				var that = this;
				if (aRequestDetails.length == 1) { // since no other request will be issued, send the received event at this point
					setTimeout(function() {
						that.fireDataReceived();
					});
				}
				this.bArtificalRootContext = true;
				// return immediately - no need to load data...
				continue;
			}
			var sPath = oAnalyticalQueryRequest.getURIToQueryResultEntries();
			if (sPath.indexOf("/") == 0) sPath = sPath.substring(1);
			if (! this._isRequestPending(oRequestDetails.sRequestId)) {
				/* side note: the check for a pending request is repeated at this point (first check occurs in _getContextsForParentGroupId),
				   because the logic executed for a call to the binding API may yield to identical OData requests in a single batch. 
				   Since _processRequestQueue, and hence also _executeBatchRequest are executed asynchronously, this method is the first place 
				   where the set of all operations included in the batch request becomes known and this condition can be checked. */  
				this._registerNewRequest(oRequestDetails.sRequestId);
				aBatchQueryRequest.push(this.oModel.createBatchOperation(sPath.replace(/\ /g, "%20"), "GET"));
				aExecutedRequestDetails.push(oRequestDetails);
			}
		}

		jQuery.sap.log.debug("AnalyticalBinding: executing batch request with " + aExecutedRequestDetails.length + " operations");
		
		var iRequestHandleId = this._getIdForNewRequestHandle();
		if (aBatchQueryRequest.length > 0) {
			this.oModel.addBatchReadOperations(aBatchQueryRequest);
			this.fireDataRequested();
			var oRequestHandle = this.oModel.submitBatch(fnSuccess, fnError, true, true);

			// fire event to indicate sending of a new request
			this.oModel.fireRequestSent({url : this.oModel.sServiceUrl	+ "/$batch", type : "POST", async : true,
				info: "",
				infoObject : {}
			});

			this._registerNewRequestHandle(iRequestHandleId, oRequestHandle);
		}

		function fnSuccess(oData, response) {
			that._deregisterHandleOfCompletedRequest(iRequestHandleId);
			
			if (aExecutedRequestDetails.length != oData.__batchResponses.length)
				jQuery.sap.log.fatal("assertion failed: received " + oData.__batchResponses.length 
						+ " responses for " + aExecutedRequestDetails.length + " read operations in the batch request");
	
			if (iCurrentAnalyticalInfoVersion != that.iAnalyticalInfoVersionNumber) {
				// discard responses for outdated analytical infos
				for(var i = -1, sRequestId; sRequestId = aExecutedRequestDetails[++i].sRequestId;) {
					that._deregisterCompletedRequest(sRequestId);
					that._cleanupGroupingForCompletedRequest(sRequestId);
				}
				return;
			}
			
			for (var i = 0; i < oData.__batchResponses.length; i++) {
				if (oData.__batchResponses[i].data != undefined) {
					switch (aExecutedRequestDetails[i].iRequestType) {
						case AnalyticalBinding._requestType.groupMembersQuery:
							that._processGroupMembersQueryResponse(aExecutedRequestDetails[i], oData.__batchResponses[i].data);
							break;
						case AnalyticalBinding._requestType.totalSizeQuery:
							that._processTotalSizeQueryResponse(aExecutedRequestDetails[i], oData.__batchResponses[i].data);
							break;
						case AnalyticalBinding._requestType.levelMembersQuery:
							that._processLevelMembersQueryResponse(aExecutedRequestDetails[i], oData.__batchResponses[i].data);
							break;
						default:
							jQuery.sap.log.fatal("invalid request type " + aExecutedRequestDetails[i].iRequestType);
						    continue;	
					}
				}
				that._deregisterCompletedRequest(aExecutedRequestDetails[i].sRequestId);
				that._cleanupGroupingForCompletedRequest(aExecutedRequestDetails[i].sRequestId);
			}

			// determine the logical success status: true iff all operations succeeded
			var bOverallSuccess = true;
			var aBatchErrors = that.oModel._getBatchErrors(oData);
			if (aBatchErrors.length > 0) bOverallSuccess = false;

			// fire event to indicate completion of request
			that.oModel.fireRequestCompleted({url : response.requestUri, type : "POST", async : true, 
				info: "", 
				infoObject : {}, 
				success: bOverallSuccess, 
				errorobject: bOverallSuccess ? {} : that.oModel._handleError(aBatchErrors[0])});

			// notify all bindings of the model that the data has been changed!
			// e.g. controls in the rows need to be updated as well
			// fire only the change event is not sufficient for other bindings
			if (bOverallSuccess) {
				that.oModel.checkUpdate(); 
			}
			
			that.fireDataReceived(); // raise event here since there is no separate fnCompleted handler for batch requests
		}	
		
		function fnError (oError) {
			that._deregisterHandleOfCompletedRequest(iRequestHandleId);
			for(var i = -1, oExecutedRequestDetails; oExecutedRequestDetails = aExecutedRequestDetails[++i];) {
				that._deregisterCompletedRequest(oExecutedRequestDetails.sRequestId);
				that._cleanupGroupingForCompletedRequest(oExecutedRequestDetails.sRequestId);
			}
			if (iCurrentAnalyticalInfoVersion != that.iAnalyticalInfoVersionNumber) {
				// discard responses for outdated analytical infos
				return;
			}

			// fire event to indicate completion of request
			that.oModel.fireRequestCompleted({url : "", type : "POST", async : true, 
				info: "", 
				infoObject : {}, 
				success: false, 
				errorobject: that.oModel._handleError(oError)});
			// fire event to indicate request failure
			that.oModel.fireRequestFailed(that.oModel._handleError(oError));

			that.fireDataReceived();
		}
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._executeQueryRequest
	 */
	AnalyticalBinding.prototype._executeQueryRequest = function(oRequestDetails) {
		if (oRequestDetails.iRequestType == AnalyticalBinding._requestType.groupMembersAutoExpansionQuery) {
			// handle auto-expanding requests that are actually a bundle of multiple requests, one per level  
			for (var i = -1, oAnalyticalQueryRequest; oAnalyticalQueryRequest = oRequestDetails.aGroupMembersAutoExpansionRequestDetails[++i]; ) {
				this._executeQueryRequest(oAnalyticalQueryRequest);
			}
			return;
		}
		
		var iCurrentAnalyticalInfoVersion = this.iAnalyticalInfoVersionNumber;
	
		var oAnalyticalQueryRequest = oRequestDetails.oAnalyticalQueryRequest, sGroupId = oRequestDetails.sGroupId;

		// determine relevant request query options  
		var sPath = oAnalyticalQueryRequest.getURIToQueryResultEntitySet();
		var aParam = this._getQueryODataRequestOptions(oAnalyticalQueryRequest);
	
		var that = this;
	
		if (oAnalyticalQueryRequest.getURIQueryOptionValue("$select") == null) {
			// no dimensions and no measures requested, so create an artificial empty root context (synonym for the regular "/")
			this.fireDataRequested(); // simulate the async behavior
			var oEmptyRootContext = this.getModel().getContext("/artificialRootContent");
	
			// perform all steps of fct fnSuccess (w/o calling it, b/c its argument is some data object and not a context
			sGroupId = null;
			this.mLength[sGroupId] = 1;
			this.mFinalLength[sGroupId] = true;
			this.mKey[sGroupId] = [ "artificialRootContent" ];
			this.bNeedsUpdate = true;
			// simulate the async behavior for the root context in case of having no sums (TODO: reconsider!)
			var that = this;
			setTimeout(function() {
				if (that._cleanupGroupingForCompletedRequest(oRequestDetails.sRequestId)) that.fireDataReceived();
			});
			this.bArtificalRootContext = true;
			// return immediately - no need to load data...
			return;
		}
		this._registerNewRequest(oRequestDetails.sRequestId);
		// execute the request and use the metadata if available
		this.fireDataRequested();
		for (var i = 0; i < aParam.length; i++) 
			aParam[i] = aParam[i].replace(/\ /g, "%20");
		jQuery.sap.log.debug("AnalyticalBinding: executing query request");	
		
		var iRequestHandleId = this._getIdForNewRequestHandle();
		this.oModel._loadData(sPath, aParam, fnSuccess, fnError, false, fnUpdateHandle, fnCompleted);
	
		function fnSuccess(oData) {
			that._deregisterHandleOfCompletedRequest(iRequestHandleId);
			
			if (iCurrentAnalyticalInfoVersion != that.iAnalyticalInfoVersionNumber) {
				// discard responses for outdated analytical infos
				that._deregisterCompletedRequest(oRequestDetails.sRequestId);
				return;
			}
			switch (oRequestDetails.iRequestType) {
				case AnalyticalBinding._requestType.groupMembersQuery:
					that._processGroupMembersQueryResponse(oRequestDetails, oData);
					break;
				case AnalyticalBinding._requestType.totalSizeQuery:
					that._processTotalSizeQueryResponse(oRequestDetails, oData);
					break;
				case AnalyticalBinding._requestType.levelMembersQuery:
					that._processLevelMembersQueryResponse(oRequestDetails, oData);
					break;
				default:
					jQuery.sap.log.fatal("invalid request type " + oRequestDetails.iRequestType);
			    	break;	
			}
			that._deregisterCompletedRequest(oRequestDetails.sRequestId);
		}
	
		function fnCompleted() {
			if (iCurrentAnalyticalInfoVersion != that.iAnalyticalInfoVersionNumber) {
				// discard responses for outdated analytical infos
				return;
			}
			if (that._cleanupGroupingForCompletedRequest(oRequestDetails.sRequestId)) 
				that.fireDataReceived();
		}
	
		function fnError(oData) {
	
			that._deregisterHandleOfCompletedRequest(iRequestHandleId);
			that._deregisterCompletedRequest(oRequestDetails.sRequestId);
			that._cleanupGroupingForCompletedRequest(oRequestDetails.sRequestId);
			if (iCurrentAnalyticalInfoVersion != that.iAnalyticalInfoVersionNumber) {
				// discard responses for outdated analytical infos
				return;
			}
			that.fireDataReceived();
		}
	
		function fnUpdateHandle(oRequestHandle) {
			that._registerNewRequestHandle(iRequestHandleId, oRequestHandle);
		}
	
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._abortAllPendingRequests
	 */
	AnalyticalBinding.prototype._abortAllPendingRequests = function() {
		this._abortAllPendingRequestsByHandle();
		this._clearAllPendingRequests();
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._processGroupMembersQueryResponse
	 */
	AnalyticalBinding.prototype._processGroupMembersQueryResponse = function(oRequestDetails, oData) {
		var sGroupId = oRequestDetails.sGroupId, aSelectedUnitPropertyName = oRequestDetails.aSelectedUnitPropertyName, 
		aAggregationLevel = oRequestDetails.aAggregationLevel, 
		iStartIndex = oRequestDetails.iStartIndex, iLength = oRequestDetails.iLength,
		iGroupMembersLevel = sGroupId == null ? 0 : this._getGroupIdLevel(sGroupId) + 1;
	
		
		if (!this.mKey[sGroupId]) this.mKey[sGroupId] = [];
	
		var aKey = this.mKey[sGroupId];
		var iKeyIndex = iStartIndex;
		var bUnitCheckRequired = (aSelectedUnitPropertyName.length > 0);
		var sPreviousEntryDimensionKeyString = null, sDimensionKeyString = null;
		var iFirstMatchingEntryIndex = -1;
		var iDiscardedEntriesCount = 0;
		var aAllDimensionSortedByName = null;
	
		// Collecting contexts
		for (var i = 0; i < oData.results.length; i++) {
			var oEntry = oData.results[i];
	
			if (bUnitCheckRequired) {
				// perform check to detect multiple returned entries for a single group level instance; duplicates are detected by having the same dimension keys  
				sDimensionKeyString = "";
				for (var j = 0; j < aAggregationLevel.length; j++) {
					sDimensionKeyString += oEntry[aAggregationLevel[j]] + "|";
				}
				if (sPreviousEntryDimensionKeyString == sDimensionKeyString) {
					if (iFirstMatchingEntryIndex == -1) iFirstMatchingEntryIndex = i - 1;
					var iDeviatingUnitPropertyNameIndex = -1, oPreviousEntry = oData.results[i - 1];
					for (var k = 0; k < aSelectedUnitPropertyName.length; k++) {
						if (oPreviousEntry[aSelectedUnitPropertyName[k]] != oEntry[aSelectedUnitPropertyName[k]]) {
							iDeviatingUnitPropertyNameIndex = k; // aggregating dimensions are all the same, entries only differ in currency
							break;
						}
					}
					if (iDeviatingUnitPropertyNameIndex == -1)
						jQuery.sap.log.fatal("assertion failed: no deviating units found for result entries " + (i - 1)
								+ " and " + i);
				}
				if ((sPreviousEntryDimensionKeyString != sDimensionKeyString || i == oData.results.length - 1)
						&& iFirstMatchingEntryIndex != -1) { // after sequence of identical records or if processing the last result entry
					// pick  first entry with same key combination, create a copy of it and modify that: clear all unit properties that are not part of the aggregation level, and all measures
					var oMultiUnitEntry = jQuery.extend(true, {}, oData.results[iFirstMatchingEntryIndex]);
					var oModelEntryObject = this.oModel._getObject("/"
							+ this.oModel._getKey(oData.results[iFirstMatchingEntryIndex]));
					for (var k = 0; k < aSelectedUnitPropertyName.length; k++)
						oMultiUnitEntry[aSelectedUnitPropertyName[k]] = "*";
					for ( var sMeasureName in this.oMeasureDetailsSet) {
						var oMeasureDetails = this.oMeasureDetailsSet[sMeasureName];
						// if (oMeasureDetails.unitPropertyName == undefined) continue;

						if (!oRequestDetails.bIsFlatListRequest && !this.mAnalyticalInfoByProperty[sMeasureName].total) {
							if (oMeasureDetails.rawValuePropertyName != undefined)
								oMultiUnitEntry[oMeasureDetails.rawValuePropertyName] = undefined;
							if (oMeasureDetails.formattedValuePropertyName != undefined)
								oMultiUnitEntry[oMeasureDetails.formattedValuePropertyName] = undefined;
						}
						else {
							if (oMeasureDetails.rawValuePropertyName != undefined)
								oMultiUnitEntry[oMeasureDetails.rawValuePropertyName] = null; // cannot be "*" because of type validation! 
							if (oMeasureDetails.formattedValuePropertyName != undefined)
								oMultiUnitEntry[oMeasureDetails.formattedValuePropertyName] = "*";
						}
					}
					/*
					 * assign a key to this new entry that allows to import it into the OData model that is guaranteed to be stable when used for multiple
					 * bindings 1) Take all(!) grouping dimensions in alphabetical order of their names 2) Concatenate the values of these dimenensions in this
					 * order separated by "," 3) append some indicator such as "-multiunit-not-dereferencable" to mark this special entry
					 */
					var sMultiUnitEntryKey = "";
					if (aAllDimensionSortedByName == null)
						// a complete set of sorted dimension names are the basis for stable key values; create array lazily
						aAllDimensionSortedByName = this.oAnalyticalQueryResult.getAllDimensionNames().concat([]).sort();
	
					for (var k = 0; k < aAllDimensionSortedByName.length; k++) {
						var sDimVal = oMultiUnitEntry[aAllDimensionSortedByName[k]];
						sMultiUnitEntryKey += (sDimVal === undefined ? "" : sDimVal) + ",";
					}
					// this modified copy must be imported to the OData model as a new entry with a modified key and OData metadata
					oMultiUnitEntry.__metadata.uri = sMultiUnitEntryKey + "-multiple-units-not-dereferencable";
					delete oMultiUnitEntry.__metadata["self"]; 
					delete oMultiUnitEntry.__metadata["self_link_extensions"];
					oMultiUnitEntry["^~volatile"] = true; // mark entry to distinguish it from others contained in the regular OData result
					this.oModel._importData(oMultiUnitEntry, {});
					// mark the context for this entry as volatile to facilitate special treatment by consumers
					var sMultiUnitEntryModelKey = this.oModel._getKey(oMultiUnitEntry);
					this.oModel.getContext('/' + sMultiUnitEntryModelKey)["_volatile"] = true;
	
					// finally, get the entry from the OData model and adjust array aKey to point to the modified key
					aKey[iKeyIndex - 1] = sMultiUnitEntryModelKey;
	
					// calculate how many entries have now been discarded from the result
					if (i == oData.results.length - 1 && sPreviousEntryDimensionKeyString == sDimensionKeyString) // last row same as previous
					    iDiscardedEntriesCount += i - iFirstMatchingEntryIndex;
					else // last row is different from second to last
					    iDiscardedEntriesCount += i - iFirstMatchingEntryIndex - 1;
					iFirstMatchingEntryIndex = -1;
	
					// add current entry if it has different key combination
					if (sPreviousEntryDimensionKeyString != sDimensionKeyString)
						aKey[iKeyIndex++] = this.oModel._getKey(oEntry);
				} else if (sPreviousEntryDimensionKeyString != sDimensionKeyString)
					aKey[iKeyIndex++] = this.oModel._getKey(oEntry);
				sPreviousEntryDimensionKeyString = sDimensionKeyString;
			} else
				aKey[iKeyIndex++] = this.oModel._getKey(oEntry);

			// remember mapping between entry key and group Id
			if (!oRequestDetails.bIsLeafGroupsRequest) {
				var entryGroupId = this._getGroupIdFromContext(this.oModel.getContext('/' + aKey[iKeyIndex - 1]), iGroupMembersLevel);
/* during development only
				if (this.mOwnKey[entryGroupId]) {
					if (this.mOwnKey[entryGroupId] != aKey[iKeyIndex - 1]) 
						// Such errors will occur in case repeated calls for same groups with providers returned unstable entity keys
						// E.g., HANA/XS does not provide stable keys. As s
						// As soon as repetitive calls are avoided, such errors will vanish as well
						jQuery.sap.log.debug("unstable keys detected: group ID " + entryGroupId + " does not have a unique entity key");				
				}
*/			
				this.mOwnKey[entryGroupId] = aKey[iKeyIndex - 1];
			}
		}
	
		if (! oRequestDetails.bAvoidLengthUpdate) {
			// update mLength (only when the inline count is available)
			if (oData.__count) {
				this.mLength[sGroupId] = parseInt(oData.__count, 10) - iDiscardedEntriesCount;
				this.mFinalLength[sGroupId] = true;
				
				if (oRequestDetails.bIsFlatListRequest)
					this.iTotalSize = oData.__count;
			}
		
			// if we got data and the results + startindex is larger than the
			// length we just apply this value to the length
			if (this.mLength[sGroupId] < iStartIndex + oData.results.length) {
				this.mLength[sGroupId] = iStartIndex + (oData.results.length - iDiscardedEntriesCount);
				this.mFinalLength[sGroupId] = false;
			}
		
			// if less entries are returned than have been requested
			// set length accordingly
			if ((oData.results.length - iDiscardedEntriesCount) < iLength || iLength === undefined) {
				this.mLength[sGroupId] = iStartIndex + (oData.results.length - iDiscardedEntriesCount);
				this.mFinalLength[sGroupId] = true;
			}
		
			// check if there are any results at all...
			if (oData.results.length == 0) {
				this.mLength[sGroupId] = 0;
				this.mFinalLength[sGroupId] = true;
			}
		}	
		this.bNeedsUpdate = true;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._processGroupMembersQueryResponse
	 */
	AnalyticalBinding.prototype._processTotalSizeQueryResponse = function(oRequestDetails, oData) {
		var oAnalyticalQueryRequest = oRequestDetails.oAnalyticalQueryRequest;
		
		if (oData.__count == undefined) {
			jQuery.sap.log.fatal("missing entity count in query result");
			return;
		}
		this.iTotalSize = oData.__count;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._processGroupMembersQueryResponse
	 */
	AnalyticalBinding.prototype._processLevelMembersQueryResponse = function(oRequestDetails, oData) {
		// local helper function to transform a block of entries in the level response to a response for a particular parent group 
		var processSingleGroupFromLevelSubset = function (bProcessFirstLoadedGroup, bIncompleteGroupMembersSet) {
			// transform the subset for processing as group members query response
			var oGroupMembersRequestDetails = {
				iRequestType : AnalyticalBinding._requestType.groupMembersQuery,
				sRequestId : that._getRequestId(AnalyticalBinding._requestType.groupMembersQuery, {groupId: sPreviousParentGroupId}),
				oAnalyticalQueryRequest : oRequestDetails.oAnalyticalQueryRequest,
				sGroupId : sPreviousParentGroupId,
				aSelectedUnitPropertyName : oRequestDetails.aSelectedUnitPropertyName,
				aAggregationLevel : oRequestDetails.aAggregationLevel,
				bIsFlatListRequest : oRequestDetails.bIsFlatListRequest,
				bIsLeafGroupsRequest : oRequestDetails.bIsLeafGroupsRequest,				
				iStartIndex : bProcessFirstLoadedGroup ? oRequestDetails.iStartIndex : 0,
				iLength : oRequestDetails.iLength, 
				bAvoidLengthUpdate : oRequestDetails.bAvoidLengthUpdate
			};

			// special handling for the last group contained in this level load if it starts a new group
			if (bProcessFirstLoadedGroup 
				&& oRequestDetails.iStartIndex > 0 
				&& (that.mKey[oGroupMembersRequestDetails.sGroupId] === undefined || that.mKey[oGroupMembersRequestDetails.sGroupId][oRequestDetails.iStartIndex - 1] === undefined)) {
				// pendant to bIncompleteGroupMembersSet: set the finalLength of the previous group
				var sParentGroupId = that._getParentGroupId(oGroupMembersRequestDetails.sGroupId);
				var iPositionInParentGroup = that.mKey[sParentGroupId].indexOf(that.mOwnKey[oGroupMembersRequestDetails.sGroupId]);
				if (iPositionInParentGroup == -1) jQuery.sap.log.fatal("assertion failed: failed to determine position of " + oGroupMembersRequestDetails.sGroupId + " in group " + sParentGroupId);
				if (iPositionInParentGroup > 0 && that.mKey[sParentGroupId][iPositionInParentGroup - 1] !== undefined) {
					var sPreviousGroupMemberKey = that.mKey[sParentGroupId][iPositionInParentGroup - 1];
					var sPreviousGroupId = that._getGroupIdFromContext(that.oModel.getContext('/' + sPreviousGroupMemberKey), 
							that._getGroupIdLevel(oGroupMembersRequestDetails.sGroupId));
					// only for development - if (that.mFinalLength[sPreviousGroupId]) jQuery.sap.log.fatal("assertion failed that final length of previous group id is false");
					// the final length of the previous must be set to true
					that.mFinalLength[sPreviousGroupId] = true;
					// and iStartIndex must be reset to 0, because a new group starts
					oGroupMembersRequestDetails.iStartIndex = 0;
				}
			}
			// special handling for the last group contained in this level load
			if (bIncompleteGroupMembersSet) { 
				// this will force the next call of _processGroupMembersQueryResponse() below to maintain the partial length 
				oGroupMembersRequestDetails.iLength = 0;
				that.mLength[oGroupMembersRequestDetails.sGroupId] = 0;
			}
			var oParentGroupOData = jQuery.extend(true, {}, oData);
			oParentGroupOData.results = aParentGroupODataResult;
			that._processGroupMembersQueryResponse(oGroupMembersRequestDetails, oParentGroupOData);			
		};
		
		// function implementation starts here
		var oAnalyticalQueryRequest = oRequestDetails.oAnalyticalQueryRequest, that = this;
		
		if (oData.results.length == 0) return;
		// Collecting contexts
		var sPreviousParentGroupId = this._getGroupIdFromContext( // setup for loop
				this.oModel.getContext("/" + this.oModel._getKey(oData.results[0])), oRequestDetails.iLevel - 1);
		var aParentGroupODataResult = [];
		var bProcessFirstLoadedGroup = true;
		for (var i = 0; i < oData.results.length; i++) {
			// partition the result into several subsets each of which has a common parent group Id
			var oEntry = oData.results[i];
			var oContext = this.oModel.getContext("/" + this.oModel._getKey(oData.results[i]));
			var sParentGroupId = this._getGroupIdFromContext(oContext, oRequestDetails.iLevel - 1);
			if (sPreviousParentGroupId == sParentGroupId) {
				aParentGroupODataResult.push (oEntry);
				if (i < oData.results.length - 1) continue;
			}
			processSingleGroupFromLevelSubset(bProcessFirstLoadedGroup, 
											  oData.results.length == oRequestDetails.iLength && i == oData.results.length - 1);
			// setup for processing next parent group
			bProcessFirstLoadedGroup = false;
			if (sPreviousParentGroupId != sParentGroupId) aParentGroupODataResult = [ oEntry ];
			sPreviousParentGroupId = sParentGroupId;
		}
		// process remaining left over (can happen if group ID switches on last entry)
		if (aParentGroupODataResult.length == 1) processSingleGroupFromLevelSubset(bProcessFirstLoadedGroup,
																				   oData.results.length == oRequestDetails.iLength);
	};
	
	/** *************************************************************** */
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getLoadedContextsForGroup
	 */
	AnalyticalBinding.prototype._getLoadedContextsForGroup = function(sGroupId, iStartIndex, iLength) {
		var aContext = [], oContext, aKey = this.mKey[sGroupId], sKey;
	
		if (!aKey) return aContext;
	
		if (!iStartIndex) iStartIndex = 0;
	
		if (!iLength) {
			iLength = this.oModel.iSizeLimit;
			if (this.mFinalLength[sGroupId] && this.mLength[sGroupId] < iLength) iLength = this.mLength[sGroupId];
		}
	
		//	Loop through known data and check whether we already have all rows loaded
		for (var i = iStartIndex; i < iStartIndex + iLength; i++) {
			sKey = aKey[i];
			if (!sKey) {
				break;
			}
			oContext = this.oModel.getContext('/' + sKey);
			aContext.push(oContext);
		}
	
		return aContext;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._calculateRequiredGroupSection
	 */
	AnalyticalBinding.prototype._calculateRequiredGroupSection = function(sGroupId, iStartIndex, iLength, iThreshold, aContext) {
		// implementation copied from ODataListBinding; name changed here, because analytical binding comprises more calculations 
		var bLoadNegativeEntries = false, iSectionLength, iSectionStartIndex, iPreloadedSubsequentIndex, iPreloadedPreviousIndex, iRemainingEntries, oSection = {}, aKey = this.mKey[sGroupId], sKey;
	
		iSectionStartIndex = iStartIndex;
		iSectionLength = 0;
	
		// check which data exists before startindex; If all necessary data is loaded iPreloadedPreviousIndex stays undefined
		if (!aKey) {
			iPreloadedPreviousIndex = iStartIndex;
			iPreloadedSubsequentIndex = iStartIndex + iLength;
		} else {
			for (var i = iStartIndex - 1; i >= Math.max(iStartIndex - iThreshold, 0); i--) {
				sKey = aKey[i];
				if (!sKey) {
					iPreloadedPreviousIndex = i + 1;
					break;
				}
			}
			// check which data is already loaded after startindex; If all necessary data is loaded iPreloadedSubsequentIndex stays undefined
			for (var j = iStartIndex + iLength; j < iStartIndex + iLength + iThreshold; j++) {
				sKey = aKey[j];
				if (!sKey) {
					iPreloadedSubsequentIndex = j;
					break;
				}
			}
		}
		// calculate previous remaining entries
		iRemainingEntries = iStartIndex - iPreloadedPreviousIndex;
		if (iPreloadedPreviousIndex && iStartIndex > iThreshold && iRemainingEntries < iThreshold) {
			if (aContext.length != iLength)
				iSectionStartIndex = iStartIndex - iThreshold;
			else
				iSectionStartIndex = iPreloadedPreviousIndex - iThreshold;
	
			iSectionLength = iThreshold;
		}
	
		// No negative preload needed; move startindex if we already have some data
		if (iSectionStartIndex == iStartIndex) iSectionStartIndex += aContext.length;
	
		//read the rest of the requested data
		if (aContext.length != iLength) iSectionLength += iLength - aContext.length;
	
		//calculate subsequent remaining entries 
		iRemainingEntries = iPreloadedSubsequentIndex - iStartIndex - iLength;
	
		if (iRemainingEntries == 0) iSectionLength += iThreshold;
	
		if (iPreloadedSubsequentIndex && iRemainingEntries < iThreshold && iRemainingEntries > 0) {
			//check if we need to load previous entries; If not we can move the startindex
			if (iSectionStartIndex >= iStartIndex) {
				iSectionStartIndex = iPreloadedSubsequentIndex;
				iSectionLength += iThreshold;
			}
	
		}
	
		//check final length and adapt sectionLength if needed.
		if (this.mFinalLength[sGroupId] && this.mLength[sGroupId] < (iSectionLength + iSectionStartIndex))
			iSectionLength = this.mLength[sGroupId] - iSectionStartIndex;
	
		oSection.startIndex = iSectionStartIndex;
		oSection.length = iSectionLength;
	
		return oSection;
	};

	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._calculateRequiredGroupExpansion
	 * 		Searches for missing members in the sub groups and subsequent siblings and ancestors of the given sGroupId
	 * @returns {Object} Either { groupId_Missing, startIndex_Missing, length_Missing } 
	 * expressing the number (length_Missing) of missing contexts starting in group (groupId_Missing) 
	 * at position (startIndex_Missing) using depth-first traversal of loaded data, 
	 * or { null, length_Missing } if all groups starting with the given ID (sGroupId) and all subsequent are 
	 * completely loaded and still (length_Missing) further members are missing, which cannot be fulfilled by loading data.
	 * Special case: { null, 0 } denotes that everything is loaded for the requested length.
	 */
	AnalyticalBinding.prototype._calculateRequiredGroupExpansion = function(sGroupId, iAutoExpandGroupsToLevel, iStartIndex, iLength) {
		var oNO_MISSING_MEMBER = { groupId_Missing: null, length_Missing: 0 };
		/**
		 * helper function
		 * 		Searches for missing members in the sub groups of the given sGroupId
		 * @returns {Object} Either { groupId_Missing, startIndex_Missing, length_Missing } 
		 * expressing the number (length_Missing) of missing contexts starting in group (groupId_Missing) 
		 * at position (startIndex_Missing) using depth-first traversal of loaded data, 
		 * or { null, length_Missing } if the group with given ID (sGroupId) is completely loaded
		 * and still (length_Missing) further members (of other groups) are missing.
		 * Special case: { null, 0 } denotes that everything is loaded.
		 */
		var calculateRequiredSubGroupExpansion = function(sGroupId, iAutoExpandGroupsToLevel, iStartIndex, iLength) {
			var iLevel = that._getGroupIdLevel(sGroupId);
			if (iLevel == iAutoExpandGroupsToLevel) {
				var aContext = that._getLoadedContextsForGroup(sGroupId, iStartIndex, iLength);
				var iLastLoadedIndex = iStartIndex + aContext.length - 1;
			
				if (aContext.length >= iLength)
					return oNO_MISSING_MEMBER;
				else {
					if (that.mFinalLength[sGroupId]) {
						if (aContext.length >= that.mLength[sGroupId])
							return { groupId_Missing: null, length_Missing: iLength - aContext.length }; // group completely loaded, but some members are still missing
						else
							return { groupId_Missing: sGroupId, startIndex_Missing: iLastLoadedIndex + 1, length_Missing: iLength - aContext.length }; // loading must start here
					}
					else
						return { groupId_Missing: sGroupId, startIndex_Missing: iLastLoadedIndex + 1, length_Missing: iLength - aContext.length }; // loading must start here
				}
			}
			// deepest expansion level not yet reached, so traverse groups in depth-first order
			var aContext = that._getLoadedContextsForGroup(sGroupId, iStartIndex, iLength);
			var iLength_Missing = iLength, iLastLoadedIndex = iStartIndex + aContext.length - 1;
			for (var i = -1, oContext; oContext = aContext[++i]; ) {
				iLength_Missing--; // count the current context			
				var oGroupExpansionFirstMember = calculateRequiredSubGroupExpansion(that._getGroupIdFromContext(oContext, iLevel + 1), iAutoExpandGroupsToLevel, 0, iLength_Missing);
				if (oGroupExpansionFirstMember.groupId_Missing == null) {
					if (oGroupExpansionFirstMember.length_Missing == 0)
						return oGroupExpansionFirstMember; // finished - everything is loaded
					else
						iLength_Missing = oGroupExpansionFirstMember.length_Missing;
				}
				else {
					return oGroupExpansionFirstMember; // loading must start here
				}
				if (iLength_Missing == 0) break;
			}
		
			if (that.mFinalLength[sGroupId] || iLength_Missing == 0)
				return { groupId_Missing: null, length_Missing: iLength_Missing }; // group completely loaded; maybe some members are still missing
			else
				return { groupId_Missing: sGroupId, startIndex_Missing: iLastLoadedIndex + 1, length_Missing: iLength_Missing }; // loading must start here
		};

		// function implementation starts here
		var that = this;
		var iLevel = this._getGroupIdLevel(sGroupId);
		if (iLevel == iAutoExpandGroupsToLevel + 1) {
			sGroupId = this._getParentGroupId(sGroupId);
			--iLevel;
		}
		if (sGroupId == null || iLevel > iAutoExpandGroupsToLevel) return oNO_MISSING_MEMBER;
		
		var iLength_Missing = iLength, iCurrentStartIndex = iStartIndex;
		while (sGroupId != null) {
			var oGroupExpansionFirstMember = calculateRequiredSubGroupExpansion(sGroupId, iAutoExpandGroupsToLevel, iCurrentStartIndex, iLength_Missing);
			if (oGroupExpansionFirstMember.groupId_Missing != null)
				return oGroupExpansionFirstMember;
			else if (oGroupExpansionFirstMember.length_Missing == 0)
				return oGroupExpansionFirstMember;
			else { // last sub-tree is complete, so continue calculation w/ next sibling
				var bFoundSibling = false;
				while (!bFoundSibling) {
					var sParentGroupId = this._getParentGroupId(sGroupId);
					if (sParentGroupId == null) {
						sGroupId = sParentGroupId;
						--iLevel;						
						break;
					}
					// determine position of sGroupId in members of group w/ ID sParentGroupId
					var sGroupKey = this.mOwnKey[sGroupId];
					if (! sGroupKey) {
						jQuery.sap.log.fatal("assertion failed: entitykey for group w/ ID " + sGroupId + " not available");
						return oNO_MISSING_MEMBER;
					}
					var iGroupIndex = this.mKey[sParentGroupId].indexOf(sGroupKey);
					if (iGroupIndex == -1) {
						jQuery.sap.log.fatal("assertion failed: group w/ ID " + sGroupId + " not found in members of parent w/ ID " + sParentGroupId);
						return oNO_MISSING_MEMBER;
					}
					if (iGroupIndex == this.mKey[sParentGroupId].length - 1) {
						if (this.mFinalLength[sParentGroupId]) { // last member in group
							sGroupId = sParentGroupId;
							--iLevel;
							continue; // continue with next sibling one level up
						}
						else { // some members of this level have not been loaded yet --> loading must continue at this point
							return { groupId_Missing: sParentGroupId, startIndex_Missing: iGroupIndex + 1, length_Missing: iLength_Missing };
						}
					}
					else { // continue with next sibling in same level
						sGroupKey = this.mKey[sParentGroupId][iGroupIndex + 1];
						sGroupId = this._getGroupIdFromContext(this.oModel.getContext('/' + sGroupKey), iLevel);
						bFoundSibling = true;
					}
				}
				iCurrentStartIndex = 0;
				iLength_Missing = oGroupExpansionFirstMember.length_Missing;
			}
		}
		return { groupId_Missing: null, length_Missing: iLength_Missing }; // all data loaded; number of requested members cannot be fulfilled
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getResourcePath
	 */
	AnalyticalBinding.prototype._getResourcePath = function() { 
		return this.isRelative() ? this.oModel.resolve(this.sPath, this.getContext()) : this.sPath;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getEntitySet
	 */
	AnalyticalBinding.prototype._getEntitySet = function() {
		var sEntitySet = this.sEntitySetName;
		var bindingContext = this.getContext();
		
		if (! sEntitySet) {	
			// assume absolute path complying with conventions from OData4SAP spec
			sEntitySet = this.sPath.split("/")[1];
		
			if (sEntitySet.indexOf("(") != -1) {
				sEntitySet = sEntitySet.split("(")[0] + "Results";
			}
		}
		return sEntitySet;
	
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getEffectiveSortOrder
	 * get the effective sort order for a given property considering the column settings, local sort() calls and a global sort order from bindRows 
	 */
	AnalyticalBinding.prototype._getEffectiveSortOrder = function(sPropertyName) {
		for (var i = 0; i < this.aSorter.length; i++) {
			if (this.aSorter[i] && this.aSorter[i].sPath == sPropertyName) {
				return this.aSorter[i].bDescending ? odata4analytics.SortOrder.Descending : odata4analytics.SortOrder.Ascending;
			}
		}
		return null;			
	};
	
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getFilterOperatorMatchingPropertySortOrder
	 * get the filter operator that matches the sort order set for the given property 
	 */
	AnalyticalBinding.prototype._getFilterOperatorMatchingPropertySortOrder = function(sPropertyName, bWithEqual) {
		var sFilterOperator = sap.ui.model.FilterOperator.GT; // default if no sort order applied
		switch (this._getEffectiveSortOrder(sPropertyName)) {
			case odata4analytics.SortOrder.Ascending:
				if (bWithEqual)
					sFilterOperator = sap.ui.model.FilterOperator.GE;
				else
					sFilterOperator = sap.ui.model.FilterOperator.GT;
				break;
			case odata4analytics.SortOrder.Descending:
				if (bWithEqual)
					sFilterOperator = sap.ui.model.FilterOperator.LE;
				else
					sFilterOperator = sap.ui.model.FilterOperator.LT;
				break;
		}
		return sFilterOperator;
	}
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._convertDeprecatedFilterObjects
	 */
	AnalyticalBinding.prototype._convertDeprecatedFilterObjects = function(aFilter) {
		if (! aFilter) return aFilter;
	
		// check if some filter object use the deprecated class sap.ui.model.odata.Filter; 
		// if so, convert them to sap.ui.model.Filter
		for (var i = 0, l = aFilter.length; i < l; i++) {
			if (sap.ui.model.odata && typeof sap.ui.model.odata.Filter === "function" 
				&& aFilter[i] instanceof sap.ui.model.odata.Filter)
				aFilter[i] = aFilter[i].convert();
		}
		return aFilter;
	}

	/********************************
	 *** Processing Group IDs 
	 ********************************/

	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getGroupIdFromContext
	 */
	AnalyticalBinding.prototype._getGroupIdFromContext = function(oContext, iLevel) {
	
		if (!oContext) { return null; }
		var sGroupId = "/";
		var sDimensionMember = null;
		if (iLevel > this.aAggregationLevel.length)
			jQuery.sap.log.fatal("assertion failed: aggregation level deeper than number of current aggregation levels");
		for (var i = 0; i < iLevel; i++) {
			sDimensionMember = oContext.getProperty(this.aAggregationLevel[i]);
			if (sDimensionMember != null) {
				sGroupId += encodeURIComponent(sDimensionMember) + "/"; // encode to escape slashes and at signs in the value
			} else {
				sGroupId += "@/";
			}
		}
	
		return sGroupId;
	};

	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getGroupIdLevel
	 */
	AnalyticalBinding.prototype._getGroupIdLevel = function(sGroupId) {
		if (sGroupId == null) {
			jQuery.sap.log.fatal("assertion failed: no need to determine level of group ID = null");
			return -1;
		}
		return sGroupId.split("/").length - 2;
	};

	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getGroupIdComponents
	 */
	AnalyticalBinding.prototype._getGroupIdComponents = function(sGroupId) {
		if (sGroupId == null) return null;
		var aGroupId = sGroupId.split("/");
		var aDecodedComponent = new Array();
		for (var i = 1; i < aGroupId.length - 1; i++) { // skip leading and trailing "" array elements
			if (aGroupId[i] == "@")
				aDecodedComponent[i - 1] = null;
			else
				aDecodedComponent[i - 1] = decodeURIComponent(aGroupId[i]);
		}
		return aDecodedComponent;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getGroupIdAncestors
	 * @param {integer} iNumLevels anchestors starting at the root if greater than 0, or starting at the parent of sGroupId if less than 0.
	 */
	AnalyticalBinding.prototype._getGroupIdAncestors = function(sGroupId, iNumLevels) {
		if (!iNumLevels) return [];
		if (sGroupId == null) {
			jQuery.sap.log.fatal("group ID null does not have ancestors");
			return [];
		}
		if (sGroupId == "/")
			if (Math.abs(iNumLevels) == 1) return [ null ];
			else {
				jQuery.sap.log.fatal("invalid level count " + iNumLevels + " for ancestors of groupId " + sGroupId);
				return [];
			}
		var aGroupId = sGroupId.split("/");
		var aAncestorGroupId = new Array(), sAncestorGroupId = "";
		var iFromLevel = 0, iToLevel = aGroupId.length - 3;
		if (iNumLevels > 0)
			if (iNumLevels - 1 > iToLevel)
				jQuery.sap.log.fatal("invalid level count " + iNumLevels + " for ancestors of groupId " + sGroupId);
			else iToLevel = iNumLevels - 1;
		else if (-(iNumLevels + 1) > iToLevel) jQuery.sap.log.fatal("invalid level count " + iNumLevels + " for ancestors of groupId " + sGroupId);
			else {
				iFromLevel = iToLevel + 1 + iNumLevels;
				for (var i = 0; i < iFromLevel; i++) {
					sAncestorGroupId += aGroupId[i] + "/";
				}
			}
		for (var i = iFromLevel; i <= iToLevel; i++) {
			sAncestorGroupId += aGroupId[i] + "/";
			aAncestorGroupId.push(sAncestorGroupId);
		}
		return aAncestorGroupId;
	};
	
	/**
	 * @private
	 * @function
	 * @name AnalyticalBinding.prototype._getParentGroupId
	 */
	AnalyticalBinding.prototype._getParentGroupId = function(sGroupId) {
		return this._getGroupIdAncestors(sGroupId, -1)[0];
	};
	
	AnalyticalBinding.prototype._removeDuplicatesFromStringArray = function(aString) {
		var oTemp = {};
		for (var i = 0; i < aString.length; i++)
			oTemp[aString[i]] = true;
		var aUniqueString = [];
		for (var s in oTemp)
			aUniqueString.push(s);
		return aUniqueString;
	};
	
	
	/********************************
	 *** Maintaining handles of pending requests
	 ********************************/
	
	/**
	 * Get an ID for a new request handle yet to be registered
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._getIdForNewRequestHandle = function() {
		if (this.oPendingRequestHandle === undefined) this.oPendingRequestHandle = [];
		// find first unused slot or extend array
		for (var i = 0; i < this.oPendingRequestHandle.length; i++) {
			if (this.oPendingRequestHandle[i] === undefined) return i;
		}
		this.oPendingRequestHandle[this.oPendingRequestHandle.length] = undefined;
		return this.oPendingRequestHandle.length - 1;
	};
	
	/**
	 * Register a new request handle with its given request ID
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._registerNewRequestHandle = function(iRequestHandleId, oRequestHandle) {
		if (this.oPendingRequestHandle[iRequestHandleId] !== undefined) 
			jQuery.sap.log.fatal("request handle ID already in use");
		this.oPendingRequestHandle[iRequestHandleId] = oRequestHandle;
	};
	
	/**
	 * Deregister handle of completed request
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._deregisterHandleOfCompletedRequest = function(iRequestHandleId) {
		if (this.oPendingRequestHandle[iRequestHandleId] === undefined) 
			jQuery.sap.log.fatal("no handle found for this request ID");
		this.oPendingRequestHandle[iRequestHandleId] = undefined;
	};

	/**
	 * Abort all currently sent requests, which have not yet been completed  
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._abortAllPendingRequestsByHandle = function() {
// 		this._trace_enter("ReqHandle", "_abortAllPendingRequestsByHandle"); // DISABLED FOR PRODUCTION 		
		for (var i = 0; i < this.oPendingRequestHandle.length; i++) {
// 			if (this.oPendingRequestHandle[i]) this._trace_message ("ReqHandle", "abort index " + i);
			this.oPendingRequestHandle[i] !== undefined && this.oPendingRequestHandle[i].abort();
		}
		this.oPendingRequestHandle = [];
// 		this._trace_leave("ReqHandle", "_abortAllPendingRequestsByHandle"); // DISABLED FOR PRODUCTION 		
	};
	
	/********************************
	 *** Maintaining pending requests
	 ********************************/
	
	/**
	 * Construct a request ID for a query request of the specified type
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._getRequestId = function(iRequestType, mParameters) {
		switch (iRequestType) {
		case AnalyticalBinding._requestType.groupMembersQuery:
			if (mParameters.groupId === undefined) 
				jQuery.sap.log.fatal("missing group ID");
			var sGroupId = mParameters.groupId;
			return AnalyticalBinding._requestType.groupMembersQuery + (sGroupId == null ? "" : sGroupId);
		case AnalyticalBinding._requestType.levelMembersQuery:
			if (mParameters.level === undefined) 
				jQuery.sap.log.fatal("missing level");
			if (mParameters.groupId === undefined) 
				jQuery.sap.log.fatal("missing groupId");
			// for accelerated auto-expand, group Id does not provide context, i.e. filter condition, for the requested data, but is only a starting point
			return "" + AnalyticalBinding._requestType.levelMembersQuery + mParameters.level + (this.bUseAcceleratedAutoExpand == true ? "" : mParameters.groupId);
		case AnalyticalBinding._requestType.totalSizeQuery:
			return AnalyticalBinding._requestType.totalSizeQuery;
		default:
			jQuery.sap.log.fatal("invalid request type " + iRequestType);
			return -1;
		}
	};
	
	/**
	 * Register another request to maintain its lifecycle (pending, completed)
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._registerNewRequest = function(sRequestId) {
		if (sRequestId == undefined || sRequestId == "") { 
			jQuery.sap.log.fatal("missing request ID");
			return;
		}
		if (!this.oPendingRequests[sRequestId])
			this.oPendingRequests[sRequestId] = 1;
		else
			++this.oPendingRequests[sRequestId];
	};
	
	/**
	 * Declare a group of related (pending) requests
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._considerRequestGrouping = function(aRequestId) {
		for (var i = -1, sRequestId; sRequestId = aRequestId[++i]; ) {
			if (this.oGroupedRequests[sRequestId] === undefined) this.oGroupedRequests[sRequestId] = {};
			var oGroup = this.oGroupedRequests[sRequestId];
			for (var j = 0; j < aRequestId.length; j++)
				oGroup[aRequestId[j]] = true;
		}
	};
	
	/**
	 * Is a request pending for a given group ID?
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._isRequestPending = function(sRequestId) {
		return this.oPendingRequests[sRequestId] != undefined && this.oPendingRequests[sRequestId] > 0;
	};
	
	/**
	 * Deregister a request, because its data have been received and processed. A call to this method must be followed 
	 * (not immediately, but logically) by this._cleanupGroupingForCompletedRequest to cleanup grouping information.
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype._deregisterCompletedRequest = function(sRequestId) {
		if (!this.oPendingRequests[sRequestId])
			jQuery.sap.log.fatal("assertion failed: there is no pending request ID " + sRequestId);
		if (this.oPendingRequests[sRequestId] == 1)
			delete this.oPendingRequests[sRequestId];
		else
			--this.oPendingRequests[sRequestId];
	};
	
	/**
	 * Cleanup request grouping, because its data have been received and processed. This method allows a caller to determine if it is possible
	 * to raise the "all data received" event for a group of related OData requests.
	 * 
	 * A call to this method must be preceded by this._deregisterCompletedRequest to mark the received response.
	 * 
	 * @private
	 * @function
	 * @return a Boolean whether or not all requests grouped together with this request have now been completed
	 */
	AnalyticalBinding.prototype._cleanupGroupingForCompletedRequest = function(sRequestId) {
		if (this._isRequestPending(sRequestId)) return false;
		var bGroupCompleted = true;
		if (this.oGroupedRequests[sRequestId] != undefined) {
			for ( var sOtherRequestId in this.oGroupedRequests[sRequestId]) {
				if (this.oPendingRequests[sOtherRequestId]) {
					bGroupCompleted = false;
					break;
				}
			}
		}
		if (bGroupCompleted) {
			var oRelatedGroup = this.oGroupedRequests[sRequestId];
			delete this.oGroupedRequests[sRequestId];
			for ( var sOtherRequestId in oRelatedGroup) {
				if (sOtherRequestId != sRequestId) this._cleanupGroupingForCompletedRequest(sOtherRequestId);
			}
		}
		return bGroupCompleted;
	};
	
	AnalyticalBinding.prototype._clearAllPendingRequests = function() {
		this.oPendingRequests = {};
		this.oGroupedRequests = {};
	};

	/**
	 * Resets the current list data and length
	 * 
	 * @private
	 * @function
	 */
	AnalyticalBinding.prototype.resetData = function(oContext) {
		if (oContext) {
			//Only reset specific content
			var sPath = oContext.getPath();
	
			delete this.mKey[sPath];
			delete this.mOwnKey[sPath];
			delete this.mLength[sPath];
			delete this.mFinalLength[sPath];
		} else {
			this.mKey = {};
			this.mOwnKey = {};
			this.mLength = {};
			this.mFinalLength = {};
		}
	};
	
	/**
	 * Refreshes the binding, check whether the model data has been changed and fire change event if this is the case. For server side models this should refetch
	 * the data from the server. To update a control, even if no data has been changed, e.g. to reset a control after failed validation, please use the parameter
	 * bForceUpdate.
	 * 
	 * @public
	 * @function
	 * @param {boolean}
	 *            [bForceUpdate] Update the bound control even if no data has been changed
	 * @param {object}
	 *            [mChangedEntities]
	 * @param {object}
	 *            [mEntityTypes]
	 */
	AnalyticalBinding.prototype.refresh = function(bForceUpdate, mChangedEntities, mEntityTypes) {
		var bChangeDetected = false;
		if (!bForceUpdate) {
			if (mEntityTypes) {
				var sResolvedPath = this.oModel.resolve(this.sPath, this.oContext);
				var oEntityType = this.oModel.oMetadata._getEntityTypeByPath(sResolvedPath);
				if (oEntityType && (oEntityType.entityType in mEntityTypes)) bChangeDetected = true;
			}
			if (mChangedEntities && !bChangeDetected) {
				jQuery.each(this.mKey, function(i, aNodeKeys) {
					jQuery.each(aNodeKeys, function(i, sKey) {
						if (sKey in mChangedEntities) {
							bChangeDetected = true;
							return false;
						}
					});
					if (bChangeDetected) return false;
				});
			}
			if (!mChangedEntities && !mEntityTypes) { // default
				bChangeDetected = true;
			}
		}
		if (bForceUpdate || bChangeDetected) {
			this._abortAllPendingRequests();
			this.resetData();
			this.bNeedsUpdate = false;
			this._fireRefresh({reason: sap.ui.model.ChangeReason.Refresh});
		}
	};
	
	/**
	 * Check whether this Binding would provide new values and in case it changed, inform interested parties about this.
	 * 
	 * @public
	 * @function
	 * @param {boolean}
	 *            bForceUpdate
	 * @param {object} mChangedEntities
	 */
	AnalyticalBinding.prototype.checkUpdate = function(bForceUpdate, mChangedEntities) {
		var bChangeDetected = false;
		if (!bForceUpdate) {
			if (this.bNeedsUpdate || !mChangedEntities) {
				bChangeDetected = true;
			} else {
				jQuery.each(this.mKey, function(i, aNodeKeys) {
					jQuery.each(aNodeKeys, function(i, sKey) {
						if (sKey in mChangedEntities) {
							bChangeDetected = true;
							return false;
						}
					});
					if (bChangeDetected) return false;
				});
			}
		}
		if (bForceUpdate || bChangeDetected) {
			this.bNeedsUpdate = false;
			this._fireChange();
		}
	};
	
	/**
	 * Get download URL
	 * @param {string} sFormat The required format for the download
	 * @name sap.ui.model.odata.ODataListBinding#getDownloadUrl
	 * @function
	 * @since 1.24
	 */
	AnalyticalBinding.prototype.getDownloadUrl = function(sFormat) {

		// create a new request
		var oAnalyticalQueryRequest = new odata4analytics.QueryResultRequest(this.oAnalyticalQueryResult);
		oAnalyticalQueryRequest.setResourcePath(this._getResourcePath());
		
		// add current list of dimensions
		var aSelectedDimension = [];
		var aSelectedMeasure = [];
		for (var oDimensionName in this.oDimensionDetailsSet)
			aSelectedDimension.push(oDimensionName);
		oAnalyticalQueryRequest.setAggregationLevel(aSelectedDimension);
		for (var oDimensionName in this.oDimensionDetailsSet) {
			var oDimensionDetails = this.oDimensionDetailsSet[oDimensionName];
			var bIncludeKey = (oDimensionDetails.keyPropertyName != undefined);
			var bIncludeText = (oDimensionDetails.textPropertyName != undefined);
			oAnalyticalQueryRequest.includeDimensionKeyTextAttributes(oDimensionDetails.name, // bIncludeKey: No, always needed!
					true, bIncludeText, oDimensionDetails.aAttributeName);
		}

		// add current list of measures
		for (var sMeasureName in this.oMeasureDetailsSet)
			aSelectedMeasure.push(sMeasureName);
		oAnalyticalQueryRequest.setMeasures(aSelectedMeasure);
		for ( var sMeasureName in this.oMeasureDetailsSet) {
			var oMeasureDetails = this.oMeasureDetailsSet[sMeasureName];
			var bIncludeRawValue = (oMeasureDetails.rawValuePropertyName != undefined);
			var bIncludeFormattedValue = (oMeasureDetails.formattedValuePropertyName != undefined);
			var bIncludeUnitProperty = (oMeasureDetails.unitPropertyName != undefined);
			oAnalyticalQueryRequest.includeMeasureRawFormattedValueUnit(oMeasureDetails.name, bIncludeRawValue,
					bIncludeFormattedValue, bIncludeUnitProperty);
		}
	

		// add the sorters
		var oSortExpression = oAnalyticalQueryRequest.getSortExpression();
		oSortExpression.clear();
		for (var i = 0; i < this.aSorter.length; i++) {
			if (this.aSorter[i]) {
				oSortExpression.addSorter(this.aSorter[i].sPath, this.aSorter[i].bDescending ? odata4analytics.SortOrder.Descending : odata4analytics.SortOrder.Ascending);
			}
		}

		// add the filters
		var oFilterExpression = oAnalyticalQueryRequest.getFilterExpression();
		oFilterExpression.clear();
		if (this.aApplicationFilter) {
			oFilterExpression.addUI5FilterConditions(this.aApplicationFilter);
		}
		if (this.aControlFilter) {
			oFilterExpression.addUI5FilterConditions(this.aControlFilter);
		}
		
		// determine the entityset path incl. the required params (sort, filter, ...)
		var sPath = oAnalyticalQueryRequest.getURIToQueryResultEntitySet();
		var aParam = this._getQueryODataRequestOptions(oAnalyticalQueryRequest);
		
		// search and remove the $select
		for (var i = 0, l = aParam.length; i < l; i++) {
			if (/^\$select/i.test(aParam[i])) {
				aParam.splice(i, 1);
				break;
			}
		}
		
		// add the new $select param which is sorted like the Table
		var aVisibleCols = [];
		for (var i = 0, l = this.aAnalyticalInfo.length; i < l; i++) {
			var oCol = this.aAnalyticalInfo[i];
			if (oCol.visible) {
				aVisibleCols.push(oCol.name);
			}
		}
		if (aVisibleCols.length > 0) {
			aParam.push("$select=" + aVisibleCols.join(","));
		}
		
		// insert the format as first parameter
		if (sFormat) {
			aParam.splice(0, 0, "$format=" + encodeURIComponent(sFormat));
		}
		
		// create the request URL
		if (sPath) {
			return this.oModel._createRequestUrl(sPath, null, aParam);
		}
		
	};
	
	
	/********************************
	 *** Tracing execution
	 ********************************/
	
	/** DISABLED FOR PRODUCTION 
// 	 *    to enable, search using regex for "^// (.*\._trace_.*)", replace by "$1" 
// 	 *    to disable, search using regex for "^(.*\._trace_.*)", replace by "// $1"
	 *
// 	AnalyticalBinding.prototype._trace_enter = function(groupid, scope, input_msg, _arguments, arg_components) {
		if (!this._traceMsgCtr) this._traceMsgCtr = { level: 0, msg: [] };
		this._traceMsgCtr.msg.push( { group: groupid, level: ++this._traceMsgCtr.level, scope: scope, msg: input_msg, details: _arguments, arg_components: arg_components, enter: true } );
	};
	
// 	AnalyticalBinding.prototype._trace_leave = function (groupid, scope, output_msg, results, arg_components) {
		if (!this._traceMsgCtr) throw "leave without enter";
		this._traceMsgCtr.msg.push( { group: groupid, level: this._traceMsgCtr.level--, scope: scope, msg: output_msg, details: results, arg_components: arg_components, leave: true } );
	};
	 
// 	AnalyticalBinding.prototype._trace_message = function (groupid, message, details) {
		if (!this._traceMsgCtr) throw "message without enter";
		this._traceMsgCtr.msg.push( { group: groupid, level: this._traceMsgCtr.level, msg: message, details: details } );
	};
	
// 	AnalyticalBinding.prototype._trace_dump = function (aGroupId) {
		var fRenderMessage = function (line) {
			var s = "[" + line.group + "          ".slice(0,10 - line.group.length) + "]";
			for (var i = 0; i < line.level; i++) s+= "  ";
			if (line.enter) s += "->" + line.scope + (line.msg || line.arg_components ? ":\t" : "");
			else if (line.leave) s += "<-" + line.scope + (line.msg || line.arg_components ? ":\t" : "");
			else s += "  ";
			if (line.msg) s += line.msg + ",";
			if (line.details && line.arg_components)
				for (var i = 0; i < line.arg_components.length; i++) 
					s += line.arg_components[i] + "=" + eval("line.details." + line.arg_components[i]) + (i < line.arg_components.length - 1 ? "," : ""); 
			s += "\n";
			return s;
		}
		var fRender = function (aMsg) {
			var s = "";
			for (var i = 0; i < aMsg.length; i++) {
				if (!aGroupId || aGroupId.indexOf (aMsg[i].group) != -1) s += fRenderMessage(aMsg[i]);
			}
			return s;
		} 
		if (!this._traceMsgCtr) return;
		return "\n" + fRender (this._traceMsgCtr.msg);
	};

// 	AnalyticalBinding.prototype._trace_reset = function () {
		delete this._traceMsgCtr;
	};
	**/
	
	return AnalyticalBinding;

}, /* bExport= */ true);

