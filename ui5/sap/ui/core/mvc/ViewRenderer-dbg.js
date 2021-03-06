/*!
 * SAP UI development toolkit for HTML5 (SAPUI5/OpenUI5)
 * (c) Copyright 2009-2014 SAP SE or an SAP affiliate company. 
 * Licensed under the Apache License, Version 2.0 - see LICENSE.txt.
 */

// Provides default renderer for View
sap.ui.define(['jquery.sap.global'],
	function(jQuery) {
	"use strict";


	/**
	 * @namespace View renderer.
	 * @name sap.ui.core.mvc.ViewRenderer
	 */
	var ViewRenderer = {
	};
	
	ViewRenderer.addDisplayClass = function(rm, oControl) {
		if (oControl.getDisplayBlock() || (oControl.getWidth() === "100%" && oControl.getHeight() === "100%")) {
			rm.addClass("sapUiViewDisplayBlock");
		}
	};

	return ViewRenderer;

}, /* bExport= */ true);
